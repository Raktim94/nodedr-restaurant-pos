import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaService } from '../prisma/prisma.service';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened by the app when the notification is tapped, e.g. /orders or /my-deliveries. */
  path?: string;
  data?: Record<string, string>;
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64url');

/**
 * Push notifications to the OrderRestro mobile app through Firebase Cloud
 * Messaging (HTTP v1), which delivers to Android directly and to iOS through
 * APNs. Off until a Firebase service account is configured:
 *   FCM_SERVICE_ACCOUNT_JSON (the JSON itself) or FCM_SERVICE_ACCOUNT_FILE (a path).
 * With nothing configured every call is a quiet no-op, so installs that do
 * not use the app are unaffected. A push never blocks or fails the action
 * that caused it.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private account: ServiceAccount | null | undefined;
  private cached: { token: string; expires: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private load(): ServiceAccount | null {
    if (this.account !== undefined) return this.account;
    try {
      const raw =
        process.env.FCM_SERVICE_ACCOUNT_JSON ??
        (process.env.FCM_SERVICE_ACCOUNT_FILE
          ? readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, 'utf8')
          : '');
      this.account = raw ? (JSON.parse(raw) as ServiceAccount) : null;
    } catch (e) {
      this.log.warn(`Push is off: bad FCM service account (${(e as Error).message})`);
      this.account = null;
    }
    return this.account;
  }

  get enabled() {
    return this.load() !== null;
  }

  private async accessToken(acct: ServiceAccount): Promise<string> {
    if (this.cached && this.cached.expires > Date.now() + 60_000) return this.cached.token;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(
      JSON.stringify({
        iss: acct.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    );
    const sig = createSign('RSA-SHA256').update(`${header}.${claim}`).sign(acct.private_key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claim}.${b64url(sig)}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  /** Fire and forget: never throws. */
  sendToUsers(userIds: string[], msg: PushMessage): void {
    if (userIds.length === 0 || !this.enabled) return;
    void this.deliver(userIds, msg).catch((e: Error) =>
      this.log.warn(`Push failed: ${e.message}`),
    );
  }

  private async deliver(userIds: string[], msg: PushMessage) {
    const acct = this.load();
    if (!acct) return;
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    if (devices.length === 0) return;
    const bearer = await this.accessToken(acct);
    const url = `https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`;
    for (const d of devices) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title: msg.title, body: msg.body },
            data: { ...(msg.data ?? {}), ...(msg.path ? { path: msg.path } : {}) },
            android: { priority: 'HIGH', notification: { channel_id: 'orders', sound: 'default' } },
            apns: { payload: { aps: { sound: 'default' } } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 400) {
        // UNREGISTERED / invalid: the app was removed. Forget the phone.
        const text = await res.text();
        if (/UNREGISTERED|INVALID_ARGUMENT/.test(text)) {
          await this.prisma.deviceToken.deleteMany({ where: { token: d.token } });
        }
      }
    }
  }
}
