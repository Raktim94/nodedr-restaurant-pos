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
 * tool below repeats that same check manually). Deliberately a curated
 * subset, not a 1:1 mirror of the REST API: nothing destructive (no delete-
 * order, no void/refund, no user/role management, no backup restore) is
 * reachable through MCP. See docs/integrations-api.md's "MCP server"
 * section for the full tool list and rationale.
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
    ];
  }
}
