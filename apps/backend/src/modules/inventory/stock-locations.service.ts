import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LocationTransferDto, StockLocationDto } from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toBaseQuantity, type StockUnit } from './units';

const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// Where the stock is kept. The item's total (Ingredient.currentStock) is still the one true number that
// sales, production, waste and receipts move; a location only says how much of it sits in each place.
// total - sum(levels) is "unassigned"; if sales have used more than was unassigned it goes negative and the
// matrix says the counts need refreshing, rather than inventing where the stock came from.
@Injectable()
export class StockLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(branchId: string) {
    return this.prisma.stockLocation.findMany({ where: { branchId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async create(branchId: string, dto: StockLocationDto) {
    const dup = await this.prisma.stockLocation.findUnique({ where: { branchId_name: { branchId, name: dto.name } } });
    if (dup) throw new ConflictException('There is already a place with that name.');
    const count = await this.prisma.stockLocation.count({ where: { branchId } });
    return this.prisma.stockLocation.create({ data: { branchId, name: dto.name, sortOrder: dto.sortOrder ?? count } });
  }

  async update(branchId: string, id: string, dto: Partial<StockLocationDto>) {
    const l = await this.prisma.stockLocation.findFirst({ where: { id, branchId } });
    if (!l) throw new NotFoundException('Place not found');
    if (dto.isActive === false) {
      const held = await this.prisma.stockLevel.count({ where: { locationId: id, quantity: { gt: 0 } } });
      if (held > 0) throw new ConflictException('There is still stock recorded here. Move it to another place first.');
    }
    try {
      return await this.prisma.stockLocation.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('There is already a place with that name.');
      throw e;
    }
  }

  /** Items x places. Only active items; `unassigned` may be negative (needs a recount). */
  async matrix(branchId: string) {
    const [locations, items, levels] = await Promise.all([
      this.prisma.stockLocation.findMany({ where: { branchId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.ingredient.findMany({ where: { branchId, isActive: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }], select: { id: true, name: true, unit: true, kind: true, category: true, currentStock: true, conversions: true } }),
      this.prisma.stockLevel.findMany({ where: { location: { branchId } } }),
    ]);
    const by = new Map<string, Map<string, Prisma.Decimal>>();
    for (const l of levels) {
      const m = by.get(l.ingredientId) ?? new Map();
      m.set(l.locationId, l.quantity);
      by.set(l.ingredientId, m);
    }
    return {
      locations,
      items: items.map((i) => {
        const m = by.get(i.id) ?? new Map<string, Prisma.Decimal>();
        const sum = [...m.values()].reduce((a, b) => a.plus(b), Dec(0));
        const un = Dec(i.currentStock).minus(sum);
        return {
          id: i.id, name: i.name, unit: i.unit, kind: i.kind, category: i.category, total: i.currentStock.toString(),
          levels: Object.fromEntries(locations.map((l) => [l.id, (m.get(l.id) ?? Dec(0)).toString()])),
          unassigned: un.toString(), needsRecount: un.isNegative(),
        };
      }),
    };
  }

  async transfer(branchId: string, userId: string, dto: LocationTransferDto) {
    if (dto.idempotencyKey) {
      const dup = await this.prisma.locationTransfer.findUnique({ where: { branchId_idempotencyKey: { branchId, idempotencyKey: dto.idempotencyKey } } });
      if (dup) return dup;
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${dto.ingredientId} FOR UPDATE`;
      const ing = await tx.ingredient.findFirst({ where: { id: dto.ingredientId, branchId } });
      if (!ing) throw new NotFoundException('Stock item not found');
      const ids = [dto.toLocationId, ...(dto.fromLocationId ? [dto.fromLocationId] : [])];
      const locs = await tx.stockLocation.findMany({ where: { id: { in: ids }, branchId, isActive: true } });
      if (locs.length !== ids.length) throw new NotFoundException('A place was not found or is switched off');
      const qty = toBaseQuantity(dto.quantity, dto.unit as StockUnit, ing.unit as StockUnit, ing.conversions, ing.name);
      const all = await tx.stockLevel.findMany({ where: { ingredientId: ing.id } });
      const level = (loc: string) => all.find((l) => l.locationId === loc)?.quantity ?? Dec(0);
      if (dto.fromLocationId) {
        if (Dec(level(dto.fromLocationId)).lt(qty)) {
          throw new BadRequestException(`Only ${level(dto.fromLocationId).toString()} ${ing.unit} of ${ing.name} is recorded in that place.`);
        }
        await tx.stockLevel.update({ where: { ingredientId_locationId: { ingredientId: ing.id, locationId: dto.fromLocationId } }, data: { quantity: Dec(level(dto.fromLocationId)).minus(qty) } });
      } else {
        const sum = all.reduce((a, l) => a.plus(l.quantity), Dec(0));
        const unassigned = Dec(ing.currentStock).minus(sum);
        if (unassigned.lt(qty)) throw new BadRequestException(`Only ${unassigned.isNegative() ? '0' : unassigned.toString()} ${ing.unit} of ${ing.name} is not yet placed anywhere. Count the places first.`);
      }
      await tx.stockLevel.upsert({
        where: { ingredientId_locationId: { ingredientId: ing.id, locationId: dto.toLocationId } },
        create: { ingredientId: ing.id, locationId: dto.toLocationId, quantity: qty },
        update: { quantity: Dec(level(dto.toLocationId)).plus(qty) },
      });
      const t = await tx.locationTransfer.create({
        data: { branchId, ingredientId: ing.id, fromLocationId: dto.fromLocationId ?? null, toLocationId: dto.toLocationId, quantity: qty, note: dto.note, idempotencyKey: dto.idempotencyKey, createdById: userId },
      });
      await this.audit.record({ userId, action: 'stock.location_transfer', entity: 'Ingredient', entityId: ing.id, metadata: { qty: qty.toString(), from: dto.fromLocationId ?? 'unassigned', to: dto.toLocationId } });
      return t;
    });
  }

  async transfers(branchId: string) {
    const rows = await this.prisma.locationTransfer.findMany({ where: { branchId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const [items, locs, users] = await Promise.all([
      this.prisma.ingredient.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ingredientId))] } }, select: { id: true, name: true, unit: true } }),
      this.prisma.stockLocation.findMany({ where: { branchId }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } }),
    ]);
    return rows.map((r) => ({
      ...r,
      item: items.find((i) => i.id === r.ingredientId),
      from: r.fromLocationId ? locs.find((l) => l.id === r.fromLocationId)?.name ?? '?' : 'Unassigned',
      to: locs.find((l) => l.id === r.toLocationId)?.name ?? '?',
      by: users.find((u) => u.id === r.createdById)?.name ?? null,
    }));
  }
}
