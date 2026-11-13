import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, UploadedFile, UseInterceptors, UsePipes } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { assertValidImageSignature, imageUploadOptions } from '../../common/upload/image-upload.config';
import { ApiTags } from '@nestjs/swagger';
import {
  correctProductionSchema,
  decisionSchema,
  journalAdjustmentSchema,
  stockReceiptSchema,
  stockTakeSchema,
  type StockTakeDto,
  type JournalAdjustmentDto,
  type StockReceiptDto,
  permissionSatisfied,
  productionEntrySchema,
  reasonSchema,
  wasteEntrySchema,
  type CorrectProductionDto,
  type ProductionEntryDto,
  type SessionUser,
  type WasteEntryDto,
} from '@nodedr-restaurant/types';
import { z } from 'zod';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { allowedUnits, type StockUnit } from './units';
import { ProductionService, type ProductionFilters } from './production.service';
import { StockJournalService } from './stock-journal.service';
import { WasteEntriesService, type WasteFilters } from './waste-entries.service';

const date = (v?: string) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const prodFilters = (q: Record<string, string | undefined>): ProductionFilters => ({
  from: date(q.from), to: date(q.to), productId: q.productId || undefined, location: q.location || undefined,
  shift: q.shift || undefined, employeeId: q.employeeId || undefined,
  status: (['DRAFT', 'POSTED', 'VOIDED'] as const).find((s) => s === q.status),
});
const wasteFilters = (q: Record<string, string | undefined>): WasteFilters => ({
  from: date(q.from), to: date(q.to), ingredientId: q.ingredientId || undefined, reason: q.reason || undefined,
  shift: q.shift || undefined, employeeId: q.employeeId || undefined, location: q.location || undefined,
  kind: q.kind === 'INGREDIENT' || q.kind === 'FINISHED' ? q.kind : undefined, status: q.status || undefined,
});
const reason = new ZodValidationPipe(reasonSchema);
const previewSchema = productionEntrySchema.pick({ inputs: true, outputs: true });

@ApiTags('stock-journal')
@Controller('v1/inventory')
export class StockJournalController {
  constructor(
    private readonly journal: StockJournalService,
    private readonly production: ProductionService,
    private readonly waste: WasteEntriesService,
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private access(u: SessionUser, branchId: string) {
    return this.branchAccess.assertAccess(u.restaurantId, branchId);
  }

  // ---- stock journal (the ledger) ------------------------------------------------------------

  @Auth('inventory.manage')
  @Get('journal')
  async list(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.journal.list(branchId, {
      from: date(q.from), to: date(q.to), ingredientId: q.ingredientId || undefined, type: q.type || undefined,
      productionEntryId: q.productionEntryId || undefined, wasteEntryId: q.wasteEntryId || undefined,
      cursor: q.cursor || undefined, take: q.take ? Number(q.take) : undefined,
    });
  }

  @Auth('inventory.manage')
  @Get('journal/balances')
  async balances(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string) {
    await this.access(u, branchId);
    return this.journal.balances(branchId);
  }

  @Auth('inventory.manage')
  @Get('journal/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportJournal(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.journal.exportCsv(branchId, {
      from: date(q.from), to: date(q.to), ingredientId: q.ingredientId || undefined, type: q.type || undefined,
    });
  }

  @Auth('inventory.manage')
  @Post('journal/stock-takes')
  @UsePipes(new ZodValidationPipe(stockTakeSchema))
  async stockTake(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Body() body: unknown) {
    await this.access(u, branchId);
    return this.journal.stockTake(branchId, u.id, body as StockTakeDto);
  }

  @Auth('inventory.manage')
  @Get('journal/stock-takes')
  async stockTakes(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string) {
    await this.access(u, branchId);
    return this.journal.listStockTakes(branchId);
  }

  @Auth('inventory.manage')
  @Get('journal/expiring')
  async expiring(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query('days') days?: string) {
    await this.access(u, branchId);
    return this.journal.expiring(branchId, Math.min(60, Math.max(0, Number(days) || 7)));
  }

  @Auth('inventory.manage')
  @Get('journal/reorder')
  async reorder(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string) {
    await this.access(u, branchId);
    return this.journal.reorderList(branchId);
  }

  @Auth('inventory.manage')
  @Get('journal/reorder.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async reorderCsv(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string) {
    await this.access(u, branchId);
    return this.journal.reorderCsv(branchId);
  }

  @Auth('inventory.manage')
  @Post('journal/receipts')
  @UsePipes(new ZodValidationPipe(stockReceiptSchema))
  async receive(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Body() body: unknown) {
    await this.access(u, branchId);
    return this.journal.receive(branchId, u.id, body as StockReceiptDto);
  }

  @Auth('inventory.manage')
  @Post('journal/adjustments')
  @UsePipes(new ZodValidationPipe(journalAdjustmentSchema))
  async adjust(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Body() body: unknown) {
    await this.access(u, branchId);
    return this.journal.adjust(branchId, u.id, body as JournalAdjustmentDto);
  }

  // ---- items a cook can pick (no inventory.manage needed) ------------------------------------

  @Auth('production.record')
  @Get('production/items')
  async items(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string) {
    await this.access(u, branchId);
    const rows = await this.prisma.ingredient.findMany({
      where: { branchId, isActive: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, unit: true, kind: true, category: true, currentStock: true, conversions: true },
    });
    return rows.map((r) => ({ ...r, units: allowedUnits(r.unit as StockUnit, r.conversions) }));
  }

  // ---- production -----------------------------------------------------------------------------

  @Auth('production.record')
  @Get('production')
  async listProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.production.list(branchId, prodFilters(q));
  }

  @Auth('production.record')
  @Get('production/report')
  async report(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.production.report(branchId, prodFilters(q));
  }

  @Auth('production.record')
  @Get('production/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.production.exportCsv(branchId, prodFilters(q));
  }

  @Auth('production.record')
  @Get('production/suggest/:productId')
  async suggest(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('productId') productId: string) {
    await this.access(u, branchId);
    return this.production.suggestInputs(branchId, productId);
  }

  @Auth('production.record')
  @Post('production/preview')
  @UsePipes(new ZodValidationPipe(previewSchema))
  async preview(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Body() body: unknown) {
    await this.access(u, branchId);
    return this.production.preview(branchId, body as z.infer<typeof previewSchema>);
  }

  @Auth('production.record')
  @Post('production')
  @UsePipes(new ZodValidationPipe(productionEntrySchema))
  async createProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Body() body: unknown) {
    await this.access(u, branchId);
    return this.production.create(branchId, u.id, body as ProductionEntryDto);
  }

  @Auth('production.record')
  @Get('production/:id')
  async getProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string) {
    await this.access(u, branchId);
    return this.production.get(branchId, id);
  }

  @Auth('production.record')
  @Patch('production/:id')
  @UsePipes(new ZodValidationPipe(productionEntrySchema.omit({ post: true })))
  async updateProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string, @Body() body: unknown) {
    await this.access(u, branchId);
    return this.production.updateDraft(branchId, u.id, id, body as never);
  }

  @Auth('production.record')
  @Delete('production/:id')
  async deleteProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string) {
    await this.access(u, branchId);
    return this.production.deleteDraft(branchId, id);
  }

  @Auth('production.record')
  @Post('production/:id/post')
  async postProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string) {
    await this.access(u, branchId);
    return this.production.post(branchId, u.id, id);
  }

  @Auth('production.void')
  @Post('production/:id/void')
  async voidProduction(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string, @Body(reason) body: { reason: string }) {
    await this.access(u, branchId);
    return this.production.void(branchId, u.id, id, body.reason);
  }

  @Auth('production.void')
  @Post('production/:id/correct')
  async correctProduction(
    @CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string,
    @Body(new ZodValidationPipe(correctProductionSchema)) body: CorrectProductionDto,
  ) {
    await this.access(u, branchId);
    return this.production.correct(branchId, u.id, id, body);
  }

  // ---- waste ------------------------------------------------------------------------------------

  @Auth('production.record')
  @Get('waste/entries')
  async listWaste(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.waste.list(branchId, wasteFilters(q));
  }

  @Auth('production.record')
  @Get('waste/report')
  async wasteReport(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.waste.report(branchId, wasteFilters(q));
  }

  @Auth('production.record')
  @Get('waste/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async wasteCsv(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Query() q: Record<string, string>) {
    await this.access(u, branchId);
    return this.waste.exportCsv(branchId, wasteFilters(q));
  }

  @Auth('production.record')
  @Post('waste/photo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  wastePhoto(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    assertValidImageSignature(file.path);
    return { url: `/api/uploads/${file.filename}` };
  }

  @Auth('production.record')
  @Post('waste/entries')
  @UsePipes(new ZodValidationPipe(wasteEntrySchema))
  async createWaste(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Body() body: unknown) {
    await this.access(u, branchId);
    const canApprove = permissionSatisfied(u.permissions, 'production.void');
    return this.waste.create(branchId, u.id, body as WasteEntryDto, canApprove);
  }

  @Auth('production.void')
  @Post('waste/entries/:id/approve')
  async approveWaste(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string, @Body(new ZodValidationPipe(decisionSchema)) body: { note?: string }) {
    await this.access(u, branchId);
    return this.waste.approve(branchId, u.id, id, body.note);
  }

  @Auth('production.void')
  @Post('waste/entries/:id/reject')
  async rejectWaste(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string, @Body(new ZodValidationPipe(decisionSchema)) body: { note?: string }) {
    await this.access(u, branchId);
    return this.waste.reject(branchId, u.id, id, body.note);
  }

  @Auth('production.void')
  @Post('waste/entries/:id/reverse')
  async reverseWaste(@CurrentUser() u: SessionUser, @Query('branchId') branchId: string, @Param('id') id: string, @Body(reason) body: { reason: string }) {
    await this.access(u, branchId);
    return this.waste.reverse(branchId, u.id, id, body.reason);
  }
}
