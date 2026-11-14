import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { decryptSecret, encryptSecret } from '../../integration-hub/secret-box';
import { PrismaService } from '../../prisma/prisma.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import {
  NfcError,
  newAesKeyHex,
  simulateTap,
  verifyTap,
  type VerifiedTap,
} from './nfc-sdm';

/** What a failed tap looks like to the person tapping: no hint of which check failed, never a downgrade to ordinary access. */
class NfcRefused extends HttpException {
  constructor(
    code: 'NFC_VERIFY_FAILED' | 'NFC_REPLAY' | 'NFC_OFF',
    message: string,
  ) {
    super(
      { message, code, statusCode: HttpStatus.FORBIDDEN },
      HttpStatus.FORBIDDEN,
    );
  }
}
const FAILED = () =>
  new NfcRefused(
    'NFC_VERIFY_FAILED',
    'This tag could not be verified. Scan the table QR and enter the table code, or ask the staff.',
  );

const ref = () =>
  randomBytes(8)
    .toString('base64url')
    .replace(/[-_]/g, 'x')
    .toLowerCase()
    .slice(0, 10);
const seal = (
  hex: string,
  publicRef: string,
  version: number,
  kind: 'meta' | 'file',
) => encryptSecret(hex, `nfc-tag:${publicRef}:${version}:${kind}`);
const unseal = (
  stored: string,
  publicRef: string,
  version: number,
  kind: 'meta' | 'file',
) => decryptSecret(stored, `nfc-tag:${publicRef}:${version}:${kind}`);

export interface TagView {
  id: string;
  publicRef: string;
  tableId: string;
  tableNumber: string;
  label: string | null;
  mode: 'SECURE' | 'BASIC';
  status: 'PROVISIONING' | 'ACTIVE' | 'DISABLED';
  uid: string | null;
  keyVersion: number;
  lastCounter: number;
  lastAuthAt: Date | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  replacesId: string | null;
  createdAt: Date;
}

@Injectable()
export class NfcService {
  private readonly logger = new Logger(NfcService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: TableSessionsService,
  ) {}

  // ---- settings (the small-restaurant switches) -------------------------------------------------

  async settings(restaurantId: string) {
    const r = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: {
        requireTableSession: true,
        nfcTablesEnabled: true,
        autoTableSessions: true,
      },
    });
    return {
      ...r,
      mode:
        r.nfcTablesEnabled || r.autoTableSessions
          ? ('ADVANCED' as const)
          : ('BASIC' as const),
    };
  }

  async updateSettings(
    restaurantId: string,
    userId: string,
    dto: { nfcTablesEnabled?: boolean; autoTableSessions?: boolean },
  ) {
    // Automatic sessions need a way for a guest to prove they are at the table without a staff code.
    const current = await this.settings(restaurantId);
    const next = {
      nfcTablesEnabled: dto.nfcTablesEnabled ?? current.nfcTablesEnabled,
      autoTableSessions: dto.autoTableSessions ?? current.autoTableSessions,
    };
    if (next.autoTableSessions && !next.nfcTablesEnabled) {
      throw new BadRequestException(
        'Automatic table sessions need NFC table tags switched on first: guests have no table code to enter.',
      );
    }
    // Tags are a way to PROVE you are at the table, so proof must be required: with it off, anyone with the static QR could order.
    await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        ...next,
        ...(next.nfcTablesEnabled ? { requireTableSession: true } : {}),
      },
    });
    await this.audit.record({
      userId,
      action: 'table_ordering.settings',
      entity: 'Restaurant',
      entityId: restaurantId,
      metadata: next,
    });
    return this.settings(restaurantId);
  }

  // ---- tags ----------------------------------------------------------------------------------------

  private view(
    t: Prisma.NfcTagGetPayload<{
      include: { table: { select: { number: true } } };
    }>,
  ): TagView {
    return {
      id: t.id,
      publicRef: t.publicRef,
      tableId: t.tableId,
      tableNumber: t.table.number,
      label: t.label,
      mode: t.mode,
      status: t.status,
      uid: t.uid,
      keyVersion: t.keyVersion,
      lastCounter: t.lastCounter,
      lastAuthAt: t.lastAuthAt,
      disabledAt: t.disabledAt,
      disabledReason: t.disabledReason,
      replacesId: t.replacesId,
      createdAt: t.createdAt,
    };
  }

  async list(branchId: string): Promise<TagView[]> {
    const rows = await this.prisma.nfcTag.findMany({
      where: { branchId },
      include: { table: { select: { number: true } } },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.view(r));
  }

  private async getTag(branchId: string, id: string) {
    const t = await this.prisma.nfcTag.findFirst({
      where: { id, branchId },
      include: { table: { select: { number: true } } },
    });
    if (!t) throw new NotFoundException('NFC tag not found');
    return t;
  }

  /** The keys and URL a provisioning tool needs, returned ONCE. The keys are not recoverable afterwards. */
  private bundle(
    publicRef: string,
    keys: { metaKeyHex: string; fileKeyHex: string; appMasterKeyHex: string },
    keyVersion: number,
  ) {
    const origin =
      (process.env.CORS_ORIGIN ?? '')
        .split(',')[0]
        ?.trim()
        .replace(/\/$/, '') ?? '';
    return {
      publicRef,
      keyVersion,
      urlTemplate: `${origin || 'https://YOUR-HOST'}/t/${publicRef}?e=00000000000000000000000000000000&c=0000000000000000`,
      sdm: {
        encryptedPiccDataPlaceholder:
          'e= (32 hex characters): mirror UID and read counter, encrypted',
        macPlaceholder: 'c= (16 hex characters): the SDM MAC',
        macInputOffset:
          'set SDMMACInputOffset equal to the SDMMAC offset so the MAC covers only the UID and counter',
        mirrorUid: true,
        mirrorReadCounter: true,
      },
      keys: {
        appMasterKey: keys.appMasterKeyHex,
        sdmMetaReadKey: keys.metaKeyHex,
        sdmFileReadKey: keys.fileKeyHex,
      },
      note: 'Write these into the tag with an NTAG 424 DNA tool, then tap it and press Test tap. The server keeps only the meta-read and file-read keys (sealed) and never stores the app master key: keep it if you may re-configure this tag, otherwise discard it.',
    };
  }

  async createTag(
    branchId: string,
    userId: string,
    dto: { tableId: string; label?: string; mode?: 'SECURE' | 'BASIC' },
  ) {
    const table = await this.prisma.table.findFirst({
      where: { id: dto.tableId, floor: { branchId } },
      select: { id: true, number: true, qrToken: true },
    });
    if (!table) throw new NotFoundException('Table not found');
    const mode = dto.mode ?? 'SECURE';
    // A tag leads guests to the table's ordering page, so the table must have its ordering link. Tables created before
    // QR codes were used (or never given one) get it here, the same opaque token the printed QR carries.
    if (!table.qrToken) {
      table.qrToken = randomBytes(16).toString('hex');
      await this.prisma.table.update({
        where: { id: table.id },
        data: { qrToken: table.qrToken },
      });
    }
    const publicRef = ref();
    if (mode === 'BASIC') {
      // An ordinary NFC card holding the table's printed-QR link: it only needs recording. Same trust as the printed QR.
      const tag = await this.prisma.nfcTag.create({
        data: {
          publicRef,
          branchId,
          tableId: table.id,
          label: dto.label?.trim() || null,
          mode,
          status: 'ACTIVE',
          createdById: userId,
        },
        include: { table: { select: { number: true } } },
      });
      await this.audit.record({
        userId,
        action: 'nfc.tag_created',
        entity: 'NfcTag',
        entityId: tag.id,
        metadata: { tableId: table.id, mode },
      });
      return {
        tag: this.view(tag),
        provisioning: null,
        basicLink: {
          note: 'Write the table QR link to the card as an ordinary NDEF URL. Guests still need the table code, exactly as with the printed QR.',
          requiresTableQr: !table.qrToken,
        },
      };
    }
    const keys = {
      metaKeyHex: newAesKeyHex(),
      fileKeyHex: newAesKeyHex(),
      appMasterKeyHex: newAesKeyHex(),
    };
    const tag = await this.prisma.nfcTag.create({
      data: {
        publicRef,
        branchId,
        tableId: table.id,
        label: dto.label?.trim() || null,
        mode,
        status: 'PROVISIONING',
        metaKeySealed: seal(keys.metaKeyHex, publicRef, 1, 'meta'),
        fileKeySealed: seal(keys.fileKeyHex, publicRef, 1, 'file'),
        createdById: userId,
      },
      include: { table: { select: { number: true } } },
    });
    await this.audit.record({
      userId,
      action: 'nfc.tag_created',
      entity: 'NfcTag',
      entityId: tag.id,
      metadata: { tableId: table.id, mode },
    });
    return {
      tag: this.view(tag),
      provisioning: this.bundle(publicRef, keys, 1),
    };
  }

  private keysOf(t: {
    publicRef: string;
    keyVersion: number;
    metaKeySealed: string | null;
    fileKeySealed: string | null;
  }) {
    if (!t.metaKeySealed || !t.fileKeySealed) throw FAILED();
    return {
      metaKeyHex: unseal(t.metaKeySealed, t.publicRef, t.keyVersion, 'meta'),
      fileKeyHex: unseal(t.fileKeySealed, t.publicRef, t.keyVersion, 'file'),
    };
  }

  private async log(
    tagId: string,
    branchId: string,
    result: string,
    counter?: number,
  ) {
    await this.prisma.nfcTap
      .create({ data: { tagId, branchId, result, counter: counter ?? null } })
      .catch((e) => this.logger.warn(`tap log failed: ${String(e)}`));
  }

  /**
   * Staff proves a freshly written tag: a real tap's e and c are checked against the tag's keys. The first success binds the
   * chip's UID to this tag and makes it ACTIVE; later tests only check. A different chip is refused.
   */
  async testTap(
    branchId: string,
    userId: string,
    id: string,
    e: string,
    c: string,
  ) {
    const tag = await this.getTag(branchId, id);
    if (tag.mode !== 'SECURE')
      throw new BadRequestException('Only secure tags can be tested');
    if (tag.status === 'DISABLED')
      throw new BadRequestException(
        'This tag is disabled. Rotate its keys to set it up again.',
      );
    let v: VerifiedTap;
    try {
      v = verifyTap(this.keysOf(tag), e, c);
    } catch (err) {
      if (err instanceof NfcError) {
        await this.log(tag.id, branchId, err.code);
        throw new BadRequestException(
          'That tap did not verify. Check the keys written to the tag and the URL layout.',
        );
      }
      throw err;
    }
    if (tag.uid && tag.uid !== v.uidHex) {
      await this.log(tag.id, branchId, 'UID_MISMATCH', v.counter);
      throw new BadRequestException(
        'That tap came from a different chip than the one registered for this tag.',
      );
    }
    if (v.counter <= tag.lastCounter) {
      await this.log(tag.id, branchId, 'REPLAY', v.counter);
      throw new BadRequestException(
        'That tap was already used. Tap the tag again and test the new link.',
      );
    }
    try {
      const r = await this.prisma.nfcTag.updateMany({
        where: { id: tag.id, lastCounter: { lt: v.counter } },
        data: {
          uid: tag.uid ?? v.uidHex,
          status: 'ACTIVE',
          lastCounter: v.counter,
          lastAuthAt: new Date(),
        },
      });
      if (r.count === 0)
        throw new BadRequestException(
          'That tap was already used. Tap the tag again and test the new link.',
        );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A different tag in this restaurant is already registered with that chip.',
        );
      }
      throw err;
    }
    await this.log(tag.id, branchId, 'TEST_OK', v.counter);
    await this.audit.record({
      userId,
      action: 'nfc.tag_tested',
      entity: 'NfcTag',
      entityId: tag.id,
      metadata: { counter: v.counter, activated: tag.status !== 'ACTIVE' },
    });
    return this.view(await this.getTag(branchId, id));
  }

  /** New keys for a tag (suspected leak, scheduled rotation, or re-using a disabled tag). The old keys stop working at once. */
  async rotateKeys(branchId: string, userId: string, id: string) {
    const tag = await this.getTag(branchId, id);
    if (tag.mode !== 'SECURE')
      throw new BadRequestException('Only secure tags have keys');
    const version = tag.keyVersion + 1;
    const keys = {
      metaKeyHex: newAesKeyHex(),
      fileKeyHex: newAesKeyHex(),
      appMasterKeyHex: newAesKeyHex(),
    };
    await this.prisma.nfcTag.update({
      where: { id },
      data: {
        keyVersion: version,
        metaKeySealed: seal(keys.metaKeyHex, tag.publicRef, version, 'meta'),
        fileKeySealed: seal(keys.fileKeyHex, tag.publicRef, version, 'file'),
        status: 'PROVISIONING',
        lastCounter: -1,
        disabledAt: null,
        disabledReason: null,
      },
    });
    await this.audit.record({
      userId,
      action: 'nfc.tag_rotated',
      entity: 'NfcTag',
      entityId: id,
      metadata: { keyVersion: version },
    });
    return {
      tag: this.view(await this.getTag(branchId, id)),
      provisioning: this.bundle(tag.publicRef, keys, version),
    };
  }

  async disable(branchId: string, userId: string, id: string, reason: string) {
    const tag = await this.getTag(branchId, id);
    await this.prisma.nfcTag.update({
      where: { id },
      data: {
        status: 'DISABLED',
        disabledAt: new Date(),
        disabledReason: reason.trim().slice(0, 200),
      },
    });
    await this.audit.record({
      userId,
      action: 'nfc.tag_disabled',
      entity: 'NfcTag',
      entityId: tag.id,
      metadata: { reason },
    });
    return this.view(await this.getTag(branchId, id));
  }

  /** A damaged or lost tag: a new record for the same table, and the old one is disabled so it can never answer again. */
  async replace(branchId: string, userId: string, id: string, label?: string) {
    const old = await this.getTag(branchId, id);
    await this.disable(branchId, userId, id, 'Replaced');
    const made = await this.createTag(branchId, userId, {
      tableId: old.tableId,
      label: label ?? old.label ?? undefined,
      mode: old.mode,
    });
    await this.prisma.nfcTag.update({
      where: { id: made.tag.id },
      data: { replacesId: old.id },
    });
    return {
      ...made,
      tag: this.view(await this.getTag(branchId, made.tag.id)),
    };
  }

  async taps(branchId: string, id: string) {
    await this.getTag(branchId, id);
    return this.prisma.nfcTap.findMany({
      where: { tagId: id, branchId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, result: true, counter: true, createdAt: true },
    });
  }

  /** What a genuine tag would send, for the provisioning self-test screen. Needs the one-time keys, so it is staff-only. */
  selfTest(
    keys: { metaKeyHex: string; fileKeyHex: string },
    uidHex: string,
    counter: number,
  ) {
    return simulateTap(keys, uidHex, counter);
  }

  // ---- the public tap -----------------------------------------------------------------------------

  /**
   * A guest's phone opened the tag's URL. Order matters: nothing changes until the MAC verifies, so a forged request cannot
   * burn a real tag's counter; then the chip must be the registered one; then the counter must be strictly higher than any
   * seen (an atomic compare-and-set, so two requests for the same tap cannot both win). On success the phone gets a
   * short-lived proof for THIS table. It does not open the table.
   */
  async tap(publicRef: string, e: string, c: string) {
    const tag = await this.prisma.nfcTag.findUnique({
      where: { publicRef },
      include: {
        table: {
          select: {
            id: true,
            number: true,
            name: true,
            qrToken: true,
            floor: {
              select: {
                branch: {
                  select: {
                    restaurant: { select: { nfcTablesEnabled: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!tag || tag.mode !== 'SECURE') throw FAILED();
    if (!tag.table.floor.branch.restaurant.nfcTablesEnabled)
      throw new NfcRefused(
        'NFC_OFF',
        'Table tags are not switched on here. Scan the table QR and enter the table code, or ask the staff.',
      );
    if (tag.status !== 'ACTIVE') {
      await this.log(
        tag.id,
        tag.branchId,
        tag.status === 'DISABLED' ? 'DISABLED' : 'NOT_ACTIVE',
      );
      throw FAILED();
    }
    let v: VerifiedTap;
    try {
      v = verifyTap(this.keysOf(tag), e, c);
    } catch (err) {
      if (err instanceof NfcError) {
        await this.log(tag.id, tag.branchId, err.code);
        throw FAILED();
      }
      throw err;
    }
    if (!tag.uid || tag.uid !== v.uidHex) {
      await this.log(tag.id, tag.branchId, 'UID_MISMATCH', v.counter);
      throw FAILED();
    }
    const won = await this.prisma.nfcTag.updateMany({
      where: { id: tag.id, status: 'ACTIVE', lastCounter: { lt: v.counter } },
      data: { lastCounter: v.counter, lastAuthAt: new Date() },
    });
    if (won.count === 0) {
      await this.log(tag.id, tag.branchId, 'REPLAY', v.counter);
      throw new NfcRefused(
        'NFC_REPLAY',
        'This tap was already used. Tap the tag again.',
      );
    }
    if (!tag.table.qrToken)
      throw new ForbiddenException(
        'This table has no ordering link yet. Please ask the staff.',
      );
    const access = await this.sessions.issueAccess(tag.tableId, tag.id);
    await this.log(tag.id, tag.branchId, 'OK', v.counter);
    return {
      accessToken: access.token,
      expiresAt: access.expiresAt,
      qrToken: tag.table.qrToken,
      tableName: tag.table.name ?? `Table ${tag.table.number}`,
    };
  }
}
