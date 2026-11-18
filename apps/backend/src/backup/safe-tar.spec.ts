import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { assertSafeUploadsArchive } from './safe-tar';

// Build tar bytes directly instead of shelling out to `tar`. The production
// image uses BusyBox tar, whose `tar -tv` output represents hard links as
// regular files; a test that uses the host's GNU tar cannot catch that. These
// tests exercise the raw headers our validator actually reads.
interface Entry {
  name: string;
  type?: string;
  linkname?: string;
  data?: string;
  corruptChecksum?: boolean;
}

function header(e: Entry): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(e.name.slice(0, 100), 0, 100, 'utf8');
  h.write('0000644\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');
  h.write('0000000\0', 116, 8, 'ascii');
  const size = Buffer.byteLength(e.data ?? '');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  h.write('00000000000\0', 136, 12, 'ascii');
  h.fill(0x20, 148, 156);
  h.write(e.type ?? '0', 156, 1, 'ascii');
  if (e.linkname) h.write(e.linkname.slice(0, 100), 157, 100, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  if (e.corruptChecksum) h[148] = h[148] === 0x30 ? 0x31 : 0x30;
  return h;
}

function build(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    blocks.push(header(e));
    if (e.data) {
      const data = Buffer.from(e.data);
      blocks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

let dir: string;
let files: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'safe-tar-'));
  files = [];
});
afterEach(() => {
  for (const f of files) rmSync(f, { force: true });
  rmSync(dir, { recursive: true, force: true });
});

function write(file: string, entries: Entry[]): string {
  writeFileSync(file, gzipSync(build(entries)));
  files.push(file);
  return file;
}

describe('assertSafeUploadsArchive', () => {
  it('accepts ordinary files and folders under the expected root', async () => {
    const a = write(path.join(dir, 'ok.tar.gz'), [
      { name: 'uploads/', type: '5' },
      { name: 'uploads/a.png', data: 'x' },
      { name: 'uploads/sub/', type: '5' },
      { name: 'uploads/sub/b.jpg', data: 'y' },
    ]);
    await expect(
      assertSafeUploadsArchive(a, 'uploads'),
    ).resolves.toBeUndefined();
  });

  it('refuses a symlink even if a broken tar tool would print it as a file', async () => {
    const a = write(path.join(dir, 'sym.tar.gz'), [
      { name: 'uploads/escape', type: '2', linkname: '/etc' },
    ]);
    await expect(assertSafeUploadsArchive(a, 'uploads')).rejects.toThrow(
      /link or special/,
    );
  });

  it('refuses a hard link', async () => {
    const a = write(path.join(dir, 'hard.tar.gz'), [
      { name: 'uploads/a', data: 'x' },
      { name: 'uploads/b', type: '1', linkname: 'uploads/a' },
    ]);
    await expect(assertSafeUploadsArchive(a, 'uploads')).rejects.toThrow(
      /link or special/,
    );
  });

  it('refuses a link target hidden on a regular-looking header', async () => {
    const a = write(path.join(dir, 'target.tar.gz'), [
      { name: 'uploads/a', data: 'x', linkname: '/etc/passwd' },
    ]);
    await expect(assertSafeUploadsArchive(a, 'uploads')).rejects.toThrow(
      /link or special/,
    );
  });

  it('refuses paths that climb out or sit outside the expected root', async () => {
    const climb = write(path.join(dir, 'climb.tar.gz'), [
      { name: 'uploads/../../x', data: 'x' },
    ]);
    await expect(assertSafeUploadsArchive(climb, 'uploads')).rejects.toThrow(
      /unsafe path/,
    );
    const other = write(path.join(dir, 'other.tar.gz'), [
      { name: 'x', data: 'x' },
    ]);
    await expect(assertSafeUploadsArchive(other, 'uploads')).rejects.toThrow(
      /unsafe path/,
    );
    const abs = write(path.join(dir, 'abs.tar.gz'), [
      { name: '/tmp/x', data: 'x' },
    ]);
    await expect(assertSafeUploadsArchive(abs, 'uploads')).rejects.toThrow(
      /unsafe path/,
    );
  });

  it('refuses a corrupt header', async () => {
    const a = write(path.join(dir, 'bad.tar.gz'), [
      { name: 'uploads/a', data: 'x', corruptChecksum: true },
    ]);
    await expect(assertSafeUploadsArchive(a, 'uploads')).rejects.toThrow(
      /corrupt header/,
    );
  });
});
