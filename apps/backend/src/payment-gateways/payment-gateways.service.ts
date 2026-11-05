import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { GatewayMode, PaymentGatewayConnection } from '@prisma/client';
import { decryptSecret, encryptSecret } from '../integration-hub/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import type { GatewayContext, PaymentGatewayAdapter } from './adapters/adapter';
import { getAdapter, listAdapters } from './adapters/registry';
import { BUILTIN_CATALOG, COUNTRY_NAMES, RESEARCHED_AT } from './catalog-data';

const LIVE_PHRASE = 'ENABLE LIVE PAYMENTS';
const MAX_SHOWN = 5;

const credCtx = (rid: string, provider: string, mode: GatewayMode) =>
  `${rid}:gw:${provider}:${mode}`;

const credCol = (mode: GatewayMode) =>
  mode === 'TEST' ? 'testCredentialsEnc' : 'liveCredentialsEnc';
const keysCol = (mode: GatewayMode) =>
  mode === 'TEST' ? 'testKeys' : 'liveKeys';

export interface ConnectionView {
  provider: string;
  country: string;
  enabled: boolean;
  mode: GatewayMode;
  liveConfirmedAt: Date | null;
  testKeys: string[];
  liveKeys: string[];
  /** Whether each mode has every required field. */
  testComplete: boolean;
  liveComplete: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  /** Webhook URLs for this restaurant, one per mode (kept separate on purpose). */
  webhookPaths: { TEST: string; LIVE: string };
}

@Injectable()
export class PaymentGatewaysService implements OnModuleInit {
  private readonly logger = new Logger(PaymentGatewaysService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Refresh built-in catalog rows from catalog-data.ts. Never touches `active` after first insert. */
  async onModuleInit() {
    try {
      for (const e of BUILTIN_CATALOG) {
        const data = {
          name: e.name,
          countries: e.countries,
          integration: e.integration,
          docsUrl: e.docsUrl,
          adapter: e.adapter,
          notes: e.notes ?? null,
          sources: e.sources,
          researchedAt: RESEARCHED_AT,
        };
        const existing = await this.prisma.paymentGatewayCatalogEntry.findFirst(
          {
            where: { restaurantId: null, key: e.key },
          },
        );
        if (existing) {
          await this.prisma.paymentGatewayCatalogEntry.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await this.prisma.paymentGatewayCatalogEntry.create({
            data: { ...data, key: e.key, active: e.active ?? true },
          });
        }
      }
    } catch (e) {
      // The table may not exist until migrations have run; the catalog is
      // re-seeded on the next start rather than blocking boot.
      this.logger.warn(`Catalog seed skipped: ${(e as Error).message}`);
    }
  }

  // ----- catalog -----------------------------------------------------------

  private describeAdapter(a: PaymentGatewayAdapter | null) {
    if (!a) return null;
    return {
      fields: a.fields.map(({ validate: _v, ...f }) => f), // eslint-disable-line @typescript-eslint/no-unused-vars
      requiresCustomerPhone: !!a.requiresCustomerPhone,
      limitations: a.limitations,
    };
  }

  /** Countries that have catalog entries, for the first step of setup. */
  async countries(restaurantId: string) {
    const rows = await this.prisma.paymentGatewayCatalogEntry.findMany({
      where: { active: true, OR: [{ restaurantId: null }, { restaurantId }] },
      select: { countries: true },
    });
    const set = new Set(rows.flatMap((r) => r.countries));
    return [...set].sort().map((code) => ({
      code,
      name: COUNTRY_NAMES[code] ?? code,
    }));
  }

  /** Only the gateways for this country. Other countries' providers never appear. */
  async catalog(restaurantId: string, country: string) {
    const code = country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code))
      throw new BadRequestException('Invalid country');
    const rows = await this.prisma.paymentGatewayCatalogEntry.findMany({
      where: {
        active: true,
        countries: { has: code },
        OR: [{ restaurantId: null }, { restaurantId }],
      },
      orderBy: [{ restaurantId: 'asc' }, { name: 'asc' }],
    });
    // Integrated gateways first so a merchant's first choices can actually take payments.
    rows.sort((a, b) => Number(!!b.adapter) - Number(!!a.adapter));
    const conns = await this.prisma.paymentGatewayConnection.findMany({
      where: { restaurantId },
    });
    const byProvider = new Map(conns.map((c) => [c.provider, c]));
    return {
      country: code,
      researchedAt: RESEARCHED_AT,
      note: 'Provider availability, merchant approval, payment methods and settlement depend on the provider’s current rules and your merchant account. Choosing a country only filters this list; it does not decide where you may open an account.',
      providers: rows.slice(0, MAX_SHOWN).map((r) => {
        const adapter = getAdapter(r.adapter);
        const c = byProvider.get(r.key);
        return {
          key: r.key,
          name: r.name,
          integration: r.integration,
          docsUrl: r.docsUrl,
          notes: r.notes,
          sources: r.sources,
          custom: r.restaurantId !== null,
          integrated: !!adapter,
          ...(this.describeAdapter(adapter) ?? {
            fields: [],
            requiresCustomerPhone: false,
            limitations: [],
          }),
          connection: c ? this.view(restaurantId, c, adapter) : null,
        };
      }),
      customProviderAllowed: true,
    };
  }

  async upsertCustomEntry(
    restaurantId: string,
    input: {
      key: string;
      name: string;
      countries: string[];
      docsUrl: string;
      integration?: string;
      adapter?: string | null;
      notes?: string;
    },
  ) {
    const adapter = input.adapter ?? null;
    if (adapter && !getAdapter(adapter)) {
      throw new BadRequestException('Unknown adapter');
    }
    const key = input.key.toLowerCase();
    const data = {
      name: input.name,
      countries: input.countries.map((c) => c.toUpperCase()),
      integration: input.integration ?? 'Custom provider',
      docsUrl: input.docsUrl,
      adapter,
      notes: input.notes ?? null,
      sources: [],
      researchedAt: null,
    };
    const existing = await this.prisma.paymentGatewayCatalogEntry.findFirst({
      where: { restaurantId, key },
    });
    return existing
      ? this.prisma.paymentGatewayCatalogEntry.update({
          where: { id: existing.id },
          data,
        })
      : this.prisma.paymentGatewayCatalogEntry.create({
          data: { ...data, key, restaurantId },
        });
  }

  async deleteCustomEntry(restaurantId: string, key: string) {
    const r = await this.prisma.paymentGatewayCatalogEntry.deleteMany({
      where: { restaurantId, key },
    });
    if (!r.count) throw new NotFoundException('Custom provider not found');
    return { ok: true };
  }

  // ----- connections ---------------------------------------------------------

  private adapterFor(entry: { adapter: string | null; name: string }) {
    const a = getAdapter(entry.adapter);
    if (!a) {
      throw new BadRequestException(
        `${entry.name} is not integrated with OrderRestro yet, so credentials cannot be saved for it.`,
      );
    }
    return a;
  }

  private async entry(restaurantId: string, key: string) {
    const e = await this.prisma.paymentGatewayCatalogEntry.findFirst({
      where: {
        key,
        active: true,
        OR: [{ restaurantId }, { restaurantId: null }],
      },
      orderBy: { restaurantId: 'desc' }, // the restaurant's own row wins
    });
    if (!e) throw new NotFoundException('Unknown payment provider');
    return e;
  }

  private complete(a: PaymentGatewayAdapter, keys: string[]) {
    return a.fields
      .filter((f) => f.required)
      .every((f) => keys.includes(f.key));
  }

  view(
    restaurantId: string,
    c: PaymentGatewayConnection,
    a: PaymentGatewayAdapter | null,
  ): ConnectionView {
    const base = `/api/v1/payment-gateways/webhook/${restaurantId}/${c.provider}`;
    return {
      provider: c.provider,
      country: c.country,
      enabled: c.enabled,
      mode: c.mode,
      liveConfirmedAt: c.liveConfirmedAt,
      testKeys: c.testKeys,
      liveKeys: c.liveKeys,
      testComplete: a ? this.complete(a, c.testKeys) : c.testKeys.length > 0,
      liveComplete: a ? this.complete(a, c.liveKeys) : c.liveKeys.length > 0,
      lastTestedAt: c.lastTestedAt,
      lastTestOk: c.lastTestOk,
      lastError: c.lastError,
      webhookPaths: { TEST: `${base}/TEST`, LIVE: `${base}/LIVE` },
    };
  }

  async connections(restaurantId: string) {
    const rows = await this.prisma.paymentGatewayConnection.findMany({
      where: { restaurantId },
    });
    return Promise.all(
      rows.map(async (c) => {
        const e = await this.entry(restaurantId, c.provider).catch(() => null);
        return this.view(restaurantId, c, getAdapter(e?.adapter));
      }),
    );
  }

  /** Decrypts one mode's credentials for the length of a single call. */
  credentials(
    restaurantId: string,
    c: PaymentGatewayConnection,
    mode: GatewayMode,
  ): Record<string, string> {
    const enc = c[credCol(mode)];
    if (!enc) return {};
    try {
      return JSON.parse(
        decryptSecret(enc, credCtx(restaurantId, c.provider, mode)),
      ) as Record<string, string>;
    } catch {
      throw new BadRequestException(
        'Stored payment credentials could not be read (was the encryption key changed?). Re-enter them.',
      );
    }
  }

  context(
    restaurantId: string,
    c: PaymentGatewayConnection,
    mode: GatewayMode,
  ): GatewayContext {
    return { mode, credentials: this.credentials(restaurantId, c, mode) };
  }

  async saveCredentials(
    restaurantId: string,
    providerKey: string,
    input: {
      country: string;
      mode: GatewayMode;
      credentials: Record<string, string>;
    },
  ) {
    const entry = await this.entry(restaurantId, providerKey);
    const adapter = this.adapterFor(entry);
    const known = new Map(adapter.fields.map((f) => [f.key, f]));
    const errors: string[] = [];
    for (const [k, v] of Object.entries(input.credentials)) {
      const f = known.get(k);
      if (!f) throw new BadRequestException(`Unknown field "${k}"`);
      if (!v.trim()) continue;
      const msg = f.validate?.(v.trim(), input.mode);
      if (msg) errors.push(`${f.label}: ${msg}`);
    }
    if (errors.length) throw new BadRequestException(errors.join(' '));

    const existing = await this.prisma.paymentGatewayConnection.findUnique({
      where: { restaurantId_provider: { restaurantId, provider: providerKey } },
    });
    // Blank values mean "keep what is stored", so editing one field never forces retyping the rest.
    const merged = existing
      ? this.credentials(restaurantId, existing, input.mode)
      : {};
    for (const [k, v] of Object.entries(input.credentials)) {
      if (v.trim()) merged[k] = v.trim();
    }
    const enc = encryptSecret(
      JSON.stringify(merged),
      credCtx(restaurantId, providerKey, input.mode),
    );
    const keys = Object.keys(merged);
    const data = {
      country: input.country.toUpperCase(),
      [credCol(input.mode)]: enc,
      [keysCol(input.mode)]: keys,
      lastTestOk: null,
      lastError: null,
    };
    const row = await this.prisma.paymentGatewayConnection.upsert({
      where: { restaurantId_provider: { restaurantId, provider: providerKey } },
      create: {
        restaurantId,
        provider: providerKey,
        enabled: false,
        mode: 'TEST',
        ...data,
      },
      update: data,
    });
    return this.view(restaurantId, row, adapter);
  }

  async removeCredentials(
    restaurantId: string,
    providerKey: string,
    mode: GatewayMode,
  ) {
    const entry = await this.entry(restaurantId, providerKey);
    const c = await this.require(restaurantId, providerKey);
    const wasActiveMode = c.mode === mode;
    const row = await this.prisma.paymentGatewayConnection.update({
      where: { id: c.id },
      data: {
        [credCol(mode)]: null,
        [keysCol(mode)]: [],
        // Removing the keys of the mode in use switches collection off rather than leaving it half-configured.
        ...(wasActiveMode ? { enabled: false } : {}),
        ...(mode === 'LIVE'
          ? { mode: 'TEST', liveConfirmedAt: null, liveConfirmedById: null }
          : {}),
        lastTestOk: null,
        lastError: null,
      },
    });
    return this.view(restaurantId, row, getAdapter(entry.adapter));
  }

  async removeConnection(restaurantId: string, providerKey: string) {
    await this.prisma.paymentGatewayConnection.deleteMany({
      where: { restaurantId, provider: providerKey },
    });
    return { ok: true };
  }

  private async require(restaurantId: string, providerKey: string) {
    const c = await this.prisma.paymentGatewayConnection.findUnique({
      where: { restaurantId_provider: { restaurantId, provider: providerKey } },
    });
    if (!c) throw new NotFoundException('This gateway is not set up yet');
    return c;
  }

  async test(restaurantId: string, providerKey: string, mode?: GatewayMode) {
    const entry = await this.entry(restaurantId, providerKey);
    const adapter = this.adapterFor(entry);
    const c = await this.require(restaurantId, providerKey);
    const m = mode ?? c.mode;
    if (!this.complete(adapter, m === 'TEST' ? c.testKeys : c.liveKeys)) {
      throw new BadRequestException(
        `Enter all required ${m === 'TEST' ? 'Test' : 'Live'} credentials first`,
      );
    }
    const out = await adapter.testConnection(this.context(restaurantId, c, m));
    await this.prisma.paymentGatewayConnection.update({
      where: { id: c.id },
      data: {
        lastTestedAt: new Date(),
        lastTestOk: out.ok,
        lastError: out.ok ? null : out.message.slice(0, 300),
      },
    });
    return { ok: out.ok, mode: m, message: out.message };
  }

  /** TEST is always allowed; LIVE needs complete live keys, a passing check and a typed phrase. */
  async setMode(
    restaurantId: string,
    userId: string,
    providerKey: string,
    mode: GatewayMode,
    confirm?: string,
  ) {
    const entry = await this.entry(restaurantId, providerKey);
    const adapter = this.adapterFor(entry);
    const c = await this.require(restaurantId, providerKey);
    if (mode === 'LIVE') {
      if (!this.complete(adapter, c.liveKeys)) {
        throw new BadRequestException(
          'Enter all Live credentials before switching to Live mode',
        );
      }
      if (confirm !== LIVE_PHRASE) {
        throw new BadRequestException(
          `Type "${LIVE_PHRASE}" to confirm. Live mode charges real money.`,
        );
      }
      const out = await adapter.testConnection(
        this.context(restaurantId, c, 'LIVE'),
      );
      if (!out.ok) {
        throw new BadRequestException(
          `Live credentials were not accepted: ${out.message}`,
        );
      }
    }
    const row = await this.prisma.paymentGatewayConnection.update({
      where: { id: c.id },
      data:
        mode === 'LIVE'
          ? { mode, liveConfirmedAt: new Date(), liveConfirmedById: userId }
          : { mode },
    });
    return this.view(restaurantId, row, adapter);
  }

  /** One gateway collects payments at a time: enabling one switches the others off. */
  async setEnabled(
    restaurantId: string,
    providerKey: string,
    enabled: boolean,
  ) {
    const entry = await this.entry(restaurantId, providerKey);
    const adapter = this.adapterFor(entry);
    const c = await this.require(restaurantId, providerKey);
    if (enabled) {
      const keys = c.mode === 'TEST' ? c.testKeys : c.liveKeys;
      if (!this.complete(adapter, keys)) {
        throw new BadRequestException(
          `Enter all required ${c.mode === 'TEST' ? 'Test' : 'Live'} credentials first`,
        );
      }
      await this.prisma.paymentGatewayConnection.updateMany({
        where: { restaurantId, NOT: { id: c.id } },
        data: { enabled: false },
      });
    }
    const row = await this.prisma.paymentGatewayConnection.update({
      where: { id: c.id },
      data: { enabled },
    });
    return this.view(restaurantId, row, adapter);
  }

  /** The gateway new payments go through, or null. */
  async active(restaurantId: string) {
    const c = await this.prisma.paymentGatewayConnection.findFirst({
      where: { restaurantId, enabled: true },
    });
    if (!c) return null;
    const entry = await this.entry(restaurantId, c.provider);
    const adapter = getAdapter(entry.adapter);
    return adapter ? { connection: c, adapter } : null;
  }

  adaptersAvailable() {
    return listAdapters().map((a) => ({ key: a.key, name: a.name }));
  }
}
