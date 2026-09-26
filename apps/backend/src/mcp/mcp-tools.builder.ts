import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ReservationStatusDto, SessionUser } from '@nodedr-restaurant/types';
import { PrismaService } from '../prisma/prisma.service';
import { BranchAccessService } from '../common/services/branch-access.service';
import { OrdersService } from '../modules/orders/orders.service';
import { ReservationsService } from '../modules/reservations/reservations.service';
import { DashboardService } from '../modules/dashboard/dashboard.service';
import { MenuService } from '../modules/menu/menu.service';
import { TablesService } from '../modules/tables/tables.service';

const SPICE_LEVEL_VALUES = ['NONE', 'MILD', 'MEDIUM', 'HOT', 'EXTRA_HOT'] as const;
const TABLE_SHAPE_VALUES = ['square', 'round', 'rect'] as const;
const TABLE_STATUS_VALUES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'OUT_OF_SERVICE'] as const;
const PAYMENT_METHOD_VALUES = ['CASH', 'CARD', 'UPI', 'WALLET', 'BANK_TRANSFER', 'GIFT_CARD', 'STORE_CREDIT'] as const;

const RESERVATION_STATUS_VALUES = ['RESERVED', 'CONFIRMED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

function isReservationStatus(value: string): value is ReservationStatusDto {
  return (RESERVATION_STATUS_VALUES as readonly string[]).includes(value);
}

/** Reads and type-checks arguments tools/call sends as plain Record<string, unknown> — see McpToolsBuilder's doc comment for why this isn't zod-typed. */
class Args {
  constructor(private readonly raw: Record<string, unknown>) {}

  string(key: string): string {
    const value = this.raw[key];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`"${key}" is required and must be a string`);
    return value;
  }

  optionalString(key: string): string | undefined {
    const value = this.raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new Error(`"${key}" must be a string`);
    return value;
  }

  number(key: string): number {
    const value = this.raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${key}" is required and must be a number`);
    return value;
  }

  optionalNumber(key: string): number | undefined {
    const value = this.raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${key}" must be a number`);
    return value;
  }

  optionalBoolean(key: string): boolean | undefined {
    const value = this.raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw new Error(`"${key}" must be a boolean`);
    return value;
  }

  stringArray(key: string): string[] {
    const value = this.raw[key];
    if (!Array.isArray(value) || value.length === 0) throw new Error(`"${key}" is required and must be a non-empty array of strings`);
    return value.map((v, i) => {
      if (typeof v !== 'string' || !v.trim()) throw new Error(`${key}[${i}] must be a non-empty string`);
      return v;
    });
  }

  items(key: string): Array<{ menuItemId: string; quantity: number; modifierIds: string[]; kitchenNote?: string }> {
    const value = this.raw[key];
    if (!Array.isArray(value) || value.length === 0) throw new Error(`"${key}" is required and must be a non-empty array`);
    return value.map((raw, i) => {
      const item = raw as Record<string, unknown>;
      if (typeof item.menuItemId !== 'string' || !item.menuItemId) {
        throw new Error(`${key}[${i}].menuItemId is required and must be a string`);
      }
      if (typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw new Error(`${key}[${i}].quantity is required and must be a positive number`);
      }
      return {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        modifierIds: Array.isArray(item.modifierIds) ? (item.modifierIds as string[]) : [],
        kitchenNote: typeof item.kitchenNote === 'string' ? item.kitchenNote : undefined,
      };
    });
  }
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  readOnly: boolean;
  requiredPermission?: string;
  handler: (args: Args) => Promise<CallToolResult>;
}

/**
 * Builds a fresh McpServer bound to one authenticated staff member. Every
 * tool here calls straight into the same service methods the REST API uses
 * (OrdersService, ReservationsService, etc.) with that staff member as
 * actor, and permission-gates itself with the same PermissionKey the
 * equivalent REST route requires (services don't self-check permissions —
 * only PermissionsGuard/HTTP layer does, see permissions.guard.ts — so each
 * tool below repeats that same check manually). Covers orders (create,
 * cancel, refund), reservations, menu (categories/items, including
 * delete), and tables/floors (including delete) — full CRUD parity with
 * what that staff member's role can already do via the UI. Deliberately
 * still excluded, regardless of role: checkout/payment processing (needs
 * a real payment terminal, not something an external client should
 * fabricate), user/role management, and backup restore — each is a
 * distinct, much higher-blast-radius action (account lockout, or wiping
 * all current data) that a future tool should add on its own, not as a
 * side effect of a general "full control" pass. See
 * docs/integrations-api.md's "MCP server" section for the full tool list.
 *
 * Wired via the SDK's low-level server.setRequestHandler(ListTools/
 * CallToolRequestSchema, ...) and plain JSON Schema — not the convenience
 * registerTool(name, { inputSchema: <zod raw shape> }, handler) API —
 * deliberately, mirroring Zulivio's own MCP implementation
 * (~/zulivio/apps/backend/src/mcp/mcp-tools.builder.ts): registerTool's
 * generics, resolved against zod schemas, are known to trigger `nest
 * build`'s TypeScript compiler into "Type instantiation is excessively
 * deep" (TS2589) once enough tools accumulate. The low-level API sidesteps
 * it entirely — no fresh zod-generic inference for this file to trigger
 * that with.
 */
@Injectable()
export class McpToolsBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly orders: OrdersService,
    private readonly reservations: ReservationsService,
    private readonly dashboard: DashboardService,
    private readonly menu: MenuService,
    private readonly tables: TablesService,
  ) {}

  build(actor: SessionUser): McpServer {
    const server = new McpServer({ name: 'orderrestro', version: '1.0.0' }, { capabilities: { tools: {} } });
    const tools = this.toolDefs(actor);

    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: t.readOnly },
      })),
    }));

    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) return errorResult(new Error(`Unknown tool "${request.params.name}"`));
      if (tool.requiredPermission && !actor.permissions.includes(tool.requiredPermission)) {
        return errorResult(new Error(`Missing permission: ${tool.requiredPermission}`));
      }
      try {
        return await tool.handler(new Args(request.params.arguments ?? {}));
      } catch (err) {
        return errorResult(err);
      }
    });

    return server;
  }

  private async assertBranch(actor: SessionUser, branchId: string) {
    await this.branchAccess.assertAccess(actor.restaurantId, branchId);
  }

  private toolDefs(actor: SessionUser): ToolDef[] {
    return [
      {
        name: 'list_locations',
        title: 'List locations',
        description: "List the caller's restaurant's active locations (branches) — id, name, address, phone.",
        inputSchema: { type: 'object' },
        readOnly: true,
        handler: async () =>
          json(
            await this.prisma.branch.findMany({
              where: { restaurantId: actor.restaurantId, isActive: true },
              select: { id: true, name: true, address: true, phone: true },
              orderBy: { name: 'asc' },
            }),
          ),
      },
      {
        name: 'dashboard_summary',
        title: 'Dashboard summary',
        description: "Today's sales/orders summary for one location.",
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' } },
          required: ['branchId'],
        },
        readOnly: true,
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.dashboard.getSummary(branchId));
        },
      },
      {
        name: 'list_open_orders',
        title: 'List open orders',
        description: 'List currently open orders for one location, optionally filtered to one table.',
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' }, tableId: { type: 'string' } },
          required: ['branchId'],
        },
        readOnly: true,
        requiredPermission: 'orders.create',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.orders.listOpen(branchId, args.optionalString('tableId')));
        },
      },
      {
        name: 'get_order',
        title: 'Get order',
        description: 'Get full detail (items, KOTs, payments) for one order.',
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' }, orderId: { type: 'string' } },
          required: ['branchId', 'orderId'],
        },
        readOnly: true,
        requiredPermission: 'orders.create',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.orders.getOrder(branchId, args.string('orderId')));
        },
      },
      {
        name: 'create_order',
        title: 'Create order',
        description: 'Create a new takeaway/delivery/dine-in order at one location.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            type: { type: 'string', enum: ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'PHONE'] },
            tableId: { type: 'string' },
            guestName: { type: 'string' },
            notes: { type: 'string' },
            items: {
              type: 'array',
              description: 'Cart items: [{ menuItemId, quantity, modifierIds?, kitchenNote? }]',
            },
          },
          required: ['branchId', 'items'],
        },
        readOnly: false,
        requiredPermission: 'orders.create',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(
            await this.orders.createOrder(branchId, actor.id, {
              type: (args.optionalString('type') as never) ?? 'DINE_IN',
              tableId: args.optionalString('tableId'),
              guestName: args.optionalString('guestName'),
              notes: args.optionalString('notes'),
              items: args.items('items'),
            }),
          );
        },
      },
      {
        name: 'list_reservations',
        title: 'List reservations',
        description: 'List reservations for one location, optionally on one date (YYYY-MM-DD).',
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' }, date: { type: 'string' } },
          required: ['branchId'],
        },
        readOnly: true,
        requiredPermission: 'reservations.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.reservations.list(branchId, args.optionalString('date')));
        },
      },
      {
        name: 'create_reservation',
        title: 'Book a table (reservation)',
        description: 'Create a new table reservation at one location.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            customerName: { type: 'string' },
            phone: { type: 'string' },
            guestCount: { type: 'number' },
            reservedAt: { type: 'string', description: 'ISO 8601 date-time' },
            durationMinutes: { type: 'number' },
            tableId: { type: 'string' },
            specialRequests: { type: 'string' },
          },
          required: ['branchId', 'customerName', 'guestCount', 'reservedAt'],
        },
        readOnly: false,
        requiredPermission: 'reservations.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(
            await this.reservations.create(branchId, {
              customerName: args.string('customerName'),
              phone: args.optionalString('phone'),
              guestCount: args.number('guestCount'),
              reservedAt: new Date(args.string('reservedAt')),
              durationMinutes: args.optionalNumber('durationMinutes') ?? 90,
              tableId: args.optionalString('tableId'),
              specialRequests: args.optionalString('specialRequests'),
            }),
          );
        },
      },
      {
        name: 'update_reservation_status',
        title: 'Update reservation status',
        description: `Transition a reservation to a new status: one of ${RESERVATION_STATUS_VALUES.join(', ')}.`,
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            reservationId: { type: 'string' },
            status: { type: 'string', enum: RESERVATION_STATUS_VALUES },
          },
          required: ['branchId', 'reservationId', 'status'],
        },
        readOnly: false,
        requiredPermission: 'reservations.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const status = args.string('status');
          if (!isReservationStatus(status)) {
            throw new Error(`Invalid status "${status}". Must be one of: ${RESERVATION_STATUS_VALUES.join(', ')}`);
          }
          return json(await this.reservations.updateStatus(branchId, args.string('reservationId'), status));
        },
      },
      {
        name: 'create_menu_category',
        title: 'Create menu category',
        description: 'Create a new menu category (e.g. "Chicken", "Cocktail") at one location.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            name: { type: 'string' },
            sortOrder: { type: 'number' },
          },
          required: ['branchId', 'name'],
        },
        readOnly: false,
        requiredPermission: 'menu.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(
            await this.menu.createCategory(branchId, {
              name: args.string('name'),
              sortOrder: args.optionalNumber('sortOrder') ?? 0,
              isActive: true,
            }),
          );
        },
      },
      {
        name: 'create_menu_item',
        title: 'Create menu item',
        description: 'Create a new menu item (dish) inside an existing category, with price and optional image URL.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            categoryId: { type: 'string' },
            name: { type: 'string' },
            price: { type: 'number' },
            description: { type: 'string' },
            imageUrl: { type: 'string', description: 'Public HTTPS URL of a photo for this dish' },
            isVeg: { type: 'boolean' },
            spiceLevel: { type: 'string', enum: SPICE_LEVEL_VALUES },
          },
          required: ['branchId', 'categoryId', 'name', 'price'],
        },
        readOnly: false,
        requiredPermission: 'menu.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const spiceLevel = args.optionalString('spiceLevel') ?? 'NONE';
          if (!(SPICE_LEVEL_VALUES as readonly string[]).includes(spiceLevel)) {
            throw new Error(`Invalid spiceLevel "${spiceLevel}". Must be one of: ${SPICE_LEVEL_VALUES.join(', ')}`);
          }
          return json(
            await this.menu.createItem(branchId, {
              categoryId: args.string('categoryId'),
              name: args.string('name'),
              price: args.number('price'),
              description: args.optionalString('description'),
              imageUrl: args.optionalString('imageUrl'),
              taxRatePercent: 0,
              isVeg: args.optionalBoolean('isVeg') ?? true,
              isVegan: false,
              isJain: false,
              isHalal: false,
              isGlutenFree: false,
              spiceLevel: spiceLevel as never,
              allergens: [],
              isActive: true,
              modifierGroupIds: [],
            }),
          );
        },
      },
      {
        name: 'create_floor',
        title: 'Create floor / section',
        description: 'Create a new floor or dining section (e.g. "Main Hall", "Bar") at one location.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            name: { type: 'string' },
            sortOrder: { type: 'number' },
          },
          required: ['branchId', 'name'],
        },
        readOnly: false,
        requiredPermission: 'tables.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(
            await this.tables.createFloor(branchId, {
              name: args.string('name'),
              sortOrder: args.optionalNumber('sortOrder') ?? 0,
            }),
          );
        },
      },
      {
        name: 'create_tables_bulk',
        title: 'Bulk-create tables',
        description: 'Create multiple tables at once on one floor/section, given a list of table numbers.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            floorId: { type: 'string' },
            numbers: { type: 'array', description: 'Table numbers/names, e.g. ["1","2","3"]' },
            capacity: { type: 'number' },
            shape: { type: 'string', enum: TABLE_SHAPE_VALUES },
          },
          required: ['branchId', 'floorId', 'numbers'],
        },
        readOnly: false,
        requiredPermission: 'tables.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const shape = args.optionalString('shape') ?? 'square';
          if (!(TABLE_SHAPE_VALUES as readonly string[]).includes(shape)) {
            throw new Error(`Invalid shape "${shape}". Must be one of: ${TABLE_SHAPE_VALUES.join(', ')}`);
          }
          return json(
            await this.tables.createTables(branchId, {
              floorId: args.string('floorId'),
              numbers: args.stringArray('numbers'),
              capacity: args.optionalNumber('capacity') ?? 4,
              shape: shape as never,
            }),
          );
        },
      },
      {
        name: 'cancel_order',
        title: 'Cancel order',
        description: 'Cancel an OPEN order the kitchen has not started yet. Fails if the kitchen already began preparing it, or if it is already paid (use refund_order instead).',
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' }, orderId: { type: 'string' } },
          required: ['branchId', 'orderId'],
        },
        readOnly: false,
        requiredPermission: 'orders.cancel',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.orders.cancelOrder(branchId, args.string('orderId'), actor.id));
        },
      },
      {
        name: 'refund_order',
        title: 'Refund order',
        description: 'Refund some or all of a PAID order. Amount cannot exceed what remains refundable.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            orderId: { type: 'string' },
            amount: { type: 'number' },
            method: { type: 'string', enum: PAYMENT_METHOD_VALUES },
            reason: { type: 'string' },
          },
          required: ['branchId', 'orderId', 'amount', 'method'],
        },
        readOnly: false,
        requiredPermission: 'refunds.process',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const method = args.string('method');
          if (!(PAYMENT_METHOD_VALUES as readonly string[]).includes(method)) {
            throw new Error(`Invalid method "${method}". Must be one of: ${PAYMENT_METHOD_VALUES.join(', ')}`);
          }
          return json(
            await this.orders.refund(branchId, args.string('orderId'), actor.id, {
              amount: args.number('amount'),
              method: method as never,
              reason: args.optionalString('reason'),
            }),
          );
        },
      },
      {
        name: 'update_menu_category',
        title: 'Update menu category',
        description: 'Rename, reorder, or activate/deactivate an existing menu category.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            categoryId: { type: 'string' },
            name: { type: 'string' },
            sortOrder: { type: 'number' },
            isActive: { type: 'boolean' },
          },
          required: ['branchId', 'categoryId'],
        },
        readOnly: false,
        requiredPermission: 'menu.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const dto: Record<string, unknown> = {};
          const name = args.optionalString('name');
          const sortOrder = args.optionalNumber('sortOrder');
          const isActive = args.optionalBoolean('isActive');
          if (name !== undefined) dto.name = name;
          if (sortOrder !== undefined) dto.sortOrder = sortOrder;
          if (isActive !== undefined) dto.isActive = isActive;
          return json(await this.menu.updateCategory(branchId, args.string('categoryId'), dto as never));
        },
      },
      {
        name: 'delete_menu_category',
        title: 'Delete menu category',
        description: 'Permanently delete a menu category. Fails if it still has items — delete or move those first.',
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' }, categoryId: { type: 'string' } },
          required: ['branchId', 'categoryId'],
        },
        readOnly: false,
        requiredPermission: 'menu.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.menu.deleteCategory(branchId, args.string('categoryId')));
        },
      },
      {
        name: 'update_menu_item',
        title: 'Update menu item',
        description: 'Change any fields (price, name, description, image, availability, veg flag, spice level) on an existing menu item.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            itemId: { type: 'string' },
            name: { type: 'string' },
            price: { type: 'number' },
            description: { type: 'string' },
            imageUrl: { type: 'string' },
            isVeg: { type: 'boolean' },
            isActive: { type: 'boolean' },
            spiceLevel: { type: 'string', enum: SPICE_LEVEL_VALUES },
          },
          required: ['branchId', 'itemId'],
        },
        readOnly: false,
        requiredPermission: 'menu.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const dto: Record<string, unknown> = {};
          const name = args.optionalString('name');
          const price = args.optionalNumber('price');
          const description = args.optionalString('description');
          const imageUrl = args.optionalString('imageUrl');
          const isVeg = args.optionalBoolean('isVeg');
          const isActive = args.optionalBoolean('isActive');
          const spiceLevel = args.optionalString('spiceLevel');
          if (name !== undefined) dto.name = name;
          if (price !== undefined) dto.price = price;
          if (description !== undefined) dto.description = description;
          if (imageUrl !== undefined) dto.imageUrl = imageUrl;
          if (isVeg !== undefined) dto.isVeg = isVeg;
          if (isActive !== undefined) dto.isActive = isActive;
          if (spiceLevel !== undefined) {
            if (!(SPICE_LEVEL_VALUES as readonly string[]).includes(spiceLevel)) {
              throw new Error(`Invalid spiceLevel "${spiceLevel}". Must be one of: ${SPICE_LEVEL_VALUES.join(', ')}`);
            }
            dto.spiceLevel = spiceLevel;
          }
          return json(await this.menu.updateItem(branchId, args.string('itemId'), actor.id, dto as never));
        },
      },
      {
        name: 'delete_menu_item',
        title: 'Delete menu item',
        description: 'Permanently delete a menu item.',
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' }, itemId: { type: 'string' } },
          required: ['branchId', 'itemId'],
        },
        readOnly: false,
        requiredPermission: 'menu.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.menu.deleteItem(branchId, args.string('itemId')));
        },
      },
      {
        name: 'update_floor',
        title: 'Update floor / section',
        description: 'Rename or reorder an existing floor/section.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            floorId: { type: 'string' },
            name: { type: 'string' },
            sortOrder: { type: 'number' },
          },
          required: ['branchId', 'floorId'],
        },
        readOnly: false,
        requiredPermission: 'tables.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const dto: Record<string, unknown> = {};
          const name = args.optionalString('name');
          const sortOrder = args.optionalNumber('sortOrder');
          if (name !== undefined) dto.name = name;
          if (sortOrder !== undefined) dto.sortOrder = sortOrder;
          return json(await this.tables.updateFloor(branchId, args.string('floorId'), dto as never));
        },
      },
      {
        name: 'update_table',
        title: 'Update table',
        description: 'Change a table\'s number, name, capacity, shape or notes.',
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            tableId: { type: 'string' },
            number: { type: 'string' },
            name: { type: 'string' },
            capacity: { type: 'number' },
            shape: { type: 'string', enum: TABLE_SHAPE_VALUES },
            notes: { type: 'string' },
          },
          required: ['branchId', 'tableId'],
        },
        readOnly: false,
        requiredPermission: 'tables.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const dto: Record<string, unknown> = {};
          const number = args.optionalString('number');
          const name = args.optionalString('name');
          const capacity = args.optionalNumber('capacity');
          const shape = args.optionalString('shape');
          const notes = args.optionalString('notes');
          if (number !== undefined) dto.number = number;
          if (name !== undefined) dto.name = name;
          if (capacity !== undefined) dto.capacity = capacity;
          if (notes !== undefined) dto.notes = notes;
          if (shape !== undefined) {
            if (!(TABLE_SHAPE_VALUES as readonly string[]).includes(shape)) {
              throw new Error(`Invalid shape "${shape}". Must be one of: ${TABLE_SHAPE_VALUES.join(', ')}`);
            }
            dto.shape = shape;
          }
          return json(await this.tables.updateTable(branchId, args.string('tableId'), dto as never));
        },
      },
      {
        name: 'update_table_status',
        title: 'Update table status',
        description: `Change a table's status: one of ${TABLE_STATUS_VALUES.join(', ')}.`,
        inputSchema: {
          type: 'object',
          properties: {
            branchId: { type: 'string' },
            tableId: { type: 'string' },
            status: { type: 'string', enum: TABLE_STATUS_VALUES },
          },
          required: ['branchId', 'tableId', 'status'],
        },
        readOnly: false,
        requiredPermission: 'tables.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          const status = args.string('status');
          if (!(TABLE_STATUS_VALUES as readonly string[]).includes(status)) {
            throw new Error(`Invalid status "${status}". Must be one of: ${TABLE_STATUS_VALUES.join(', ')}`);
          }
          return json(await this.tables.updateTableStatus(branchId, args.string('tableId'), status as never));
        },
      },
      {
        name: 'delete_table',
        title: 'Delete table',
        description: 'Permanently delete a table.',
        inputSchema: {
          type: 'object',
          properties: { branchId: { type: 'string' }, tableId: { type: 'string' } },
          required: ['branchId', 'tableId'],
        },
        readOnly: false,
        requiredPermission: 'tables.manage',
        handler: async (args) => {
          const branchId = args.string('branchId');
          await this.assertBranch(actor, branchId);
          return json(await this.tables.deleteTable(branchId, args.string('tableId')));
        },
      },
    ];
  }
}
