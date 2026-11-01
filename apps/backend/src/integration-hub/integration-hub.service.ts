import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { IntegrationConnection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getProvider, listProviders } from './providers/registry';
import type { IntegrationProvider, TestResult } from './providers/provider';
import { decryptSecret, encryptSecret } from './secret-box';

export interface ConnectInput {
  externalAccountId?: string;
  /** Only the fields being set or changed; omitted secrets keep their stored value. */
  credentials: Record<string, string>;
}

const ctxKey = (restaurantId: string, provider: string) =>
  `${restaurantId}:${provider}`;

@Injectable()
export class IntegrationHubService {
  private readonly logger = new Logger(IntegrationHubService.name);

  constructor(private readonly prisma: PrismaService) {}

  private provider(key: string): IntegrationProvider {
    const p = getProvider(key);
    if (!p) throw new NotFoundException('Unknown integration');
    return p;
  }

  /** What the API may show: never the credentials, only which fields are set. */
  private view(c: IntegrationConnection | null) {
    if (!c) return null;
    const keys = (c.config as { credentialKeys?: string[] } | null)
      ?.credentialKeys;
    return {
      id: c.id,
      enabled: c.enabled,
      status: c.status,
      externalAccountId: c.externalAccountId,
      credentialsSet: Object.fromEntries((keys ?? []).map((k) => [k, true])),
      lastSyncAt: c.lastSyncAt,
      lastSuccessAt: c.lastSuccessAt,
      lastError: c.lastError,
      updatedAt: c.updatedAt,
    };
  }

  async list(restaurantId: string) {
    const rows = await this.prisma.integrationConnection.findMany({
      where: { restaurantId },
    });
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return listProviders().map((p) => ({
      key: p.key,
      name: p.name,
      category: p.category,
      description: p.description,
      capabilities: p.capabilities,
      accountIdLabel: p.accountIdLabel ?? null,
      webhookPath: p.capabilities.webhooks
        ? `/api/v1/integration-hub/webhook/${restaurantId}/${p.key}`
        : null,
      requirements: p.requirements ?? null,
      credentialFields: p.credentialFields,
      connection: this.view(byProvider.get(p.key) ?? null),
    }));
  }

  private async log(
    connectionId: string,
    level: 'INFO' | 'WARN' | 'ERROR',
    event: string,
    message: string,
  ) {
    await this.prisma.integrationLog.create({
      data: { connectionId, level, event, message: message.slice(0, 500) },
    });
  }

  private async require(restaurantId: string, providerKey: string) {
    this.provider(providerKey);
    const c = await this.prisma.integrationConnection.findUnique({
      where: { restaurantId_provider: { restaurantId, provider: providerKey } },
    });
    if (!c) throw new NotFoundException('This integration is not set up yet');
    return c;
  }

  async connect(
    restaurantId: string,
    userId: string,
    providerKey: string,
    input: ConnectInput,
  ) {
    const provider = this.provider(providerKey);
    const known = new Set(provider.credentialFields.map((f) => f.key));
    for (const k of Object.keys(input.credentials)) {
      if (!known.has(k)) {
        throw new BadRequestException(`Unknown credential field "${k}"`);
      }
    }
    const existing = await this.prisma.integrationConnection.findUnique({
      where: { restaurantId_provider: { restaurantId, provider: providerKey } },
    });

    // Merge onto what is stored so changing one field never forces re-typing the rest.
    let merged: Record<string, string> = {};
    if (existing?.credentialsEnc) {
      try {
        merged = JSON.parse(
          decryptSecret(
            existing.credentialsEnc,
            ctxKey(restaurantId, providerKey),
          ),
        ) as Record<string, string>;
      } catch {
        merged = {}; // unreadable (key changed): the caller must re-enter everything
      }
    }
    for (const [k, v] of Object.entries(input.credentials)) {
      if (v.trim() === '') delete merged[k];
      else merged[k] = v.trim();
    }
    if (merged.webhookSecret && merged.webhookSecret.length < 16) {
      throw new BadRequestException(
        'The webhook signing secret must be at least 16 characters',
      );
    }
    const missing = provider.credentialFields
      .filter((f) => f.required && !merged[f.key])
      .map((f) => f.label);
    if (missing.length) {
      throw new BadRequestException(`Enter: ${missing.join(', ')}`);
    }
    const accountId =
      input.externalAccountId?.trim() || existing?.externalAccountId || null;
    if (provider.accountIdLabel && !provider.accountIdOptional && !accountId) {
      throw new BadRequestException(`Enter the ${provider.accountIdLabel}`);
    }

    const data = {
      externalAccountId: accountId,
      credentialsEnc: encryptSecret(
        JSON.stringify(merged),
        ctxKey(restaurantId, providerKey),
      ),
      config: { credentialKeys: Object.keys(merged) } as Prisma.InputJsonValue,
      // Saving keys is not the same as a working connection: only a test
      // that the adapter itself observed succeeding can set CONNECTED.
      status:
        existing?.enabled === false
          ? ('DISABLED' as const)
          : ('PENDING_CONFIGURATION' as const),
      lastError: null,
    };
    const row = existing
      ? await this.prisma.integrationConnection.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.integrationConnection.create({
          data: {
            ...data,
            restaurantId,
            provider: providerKey,
            createdById: userId,
          },
        });
    await this.log(row.id, 'INFO', 'credentials_saved', 'Credentials saved');
    return this.view(row);
  }

  async setEnabled(
    restaurantId: string,
    providerKey: string,
    enabled: boolean,
  ) {
    const c = await this.require(restaurantId, providerKey);
    const row = await this.prisma.integrationConnection.update({
      where: { id: c.id },
      data: {
        enabled,
        // Re-enabling does not assume the old connection still works.
        status: enabled ? 'PENDING_CONFIGURATION' : 'DISABLED',
      },
    });
    await this.log(
      c.id,
      'INFO',
      enabled ? 'enabled' : 'disabled',
      enabled ? 'Enabled - run a connection test' : 'Disabled',
    );
    return this.view(row);
  }

  async test(restaurantId: string, providerKey: string) {
    const provider = this.provider(providerKey);
    const c = await this.require(restaurantId, providerKey);
    if (!c.enabled) {
      throw new BadRequestException(
        'Enable this integration before testing it',
      );
    }
    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(
        decryptSecret(
          c.credentialsEnc ?? '',
          ctxKey(restaurantId, providerKey),
        ),
      ) as Record<string, string>;
    } catch {
      const msg =
        'The saved credentials can no longer be read (the server key changed). Enter them again.';
      await this.prisma.integrationConnection.update({
        where: { id: c.id },
        data: {
          status: 'AUTH_EXPIRED',
          lastError: msg,
          lastSyncAt: new Date(),
        },
      });
      await this.log(c.id, 'ERROR', 'test', msg);
      throw new BadRequestException(msg);
    }

    let result: TestResult;
    try {
      result = await provider.testConnection({
        restaurantId,
        externalAccountId: c.externalAccountId,
        credentials,
      });
    } catch (e) {
      this.logger.warn(`${providerKey} test threw: ${(e as Error).message}`);
      result = {
        ok: false,
        status: 'SYNC_ERROR' as const,
        message: 'The connection test failed unexpectedly.',
      };
    }
    const now = new Date();
    const row = await this.prisma.integrationConnection.update({
      where: { id: c.id },
      data: {
        status: result.status,
        lastSyncAt: now,
        ...(result.ok
          ? { lastSuccessAt: now, lastError: null }
          : { lastError: result.message }),
      },
    });
    await this.log(c.id, result.ok ? 'INFO' : 'WARN', 'test', result.message);
    return {
      ok: result.ok,
      message: result.message,
      connection: this.view(row),
    };
  }

  /** Removes the connection and, with it, the stored credentials and its log. */
  async disconnect(restaurantId: string, providerKey: string) {
    const c = await this.require(restaurantId, providerKey);
    await this.prisma.integrationConnection.delete({ where: { id: c.id } });
    return { ok: true };
  }

  async logs(restaurantId: string, providerKey: string) {
    const c = await this.require(restaurantId, providerKey);
    return this.prisma.integrationLog.findMany({
      where: { connectionId: c.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        level: true,
        event: true,
        message: true,
        createdAt: true,
      },
    });
  }
}
