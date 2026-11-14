import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertSafeUploadsArchive } from './safe-tar';

describe('assertSafeUploadsArchive', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'safe-tar-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = (build: (root: string) => void, extra: string[] = []) => {
    const src = path.join(dir, 'src');
    mkdirSync(path.join(src, 'uploads'), { recursive: true });
    build(path.join(src, 'uploads'));
    const archive = path.join(dir, 'a.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', src, ...extra, 'uploads']);
    return archive;
  };

  it('accepts ordinary files and folders under the expected root', async () => {
    const a = make((r) => { writeFileSync(path.join(r, 'a.png'), 'x'); mkdirSync(path.join(r, 'sub')); writeFileSync(path.join(r, 'sub', 'b.jpg'), 'y'); });
    await expect(assertSafeUploadsArchive(a, 'uploads')).resolves.toBeUndefined();
  });
  it('refuses a symlink (it can redirect a later entry outside the target)', async () => {
    const a = make((r) => symlinkSync('/etc', path.join(r, 'escape')));
    await expect(assertSafeUploadsArchive(a, 'uploads')).rejects.toThrow(/link or special/);
  });
  it('refuses a hard link', async () => {
    const a = make((r) => { writeFileSync(path.join(r, 'a'), 'x'); linkSync(path.join(r, 'a'), path.join(r, 'b')); });
    await expect(assertSafeUploadsArchive(a, 'uploads')).rejects.toThrow(/link or special/);
  });
  it('refuses paths that climb out or sit outside the expected root', async () => {
    const src = path.join(dir, 'evil'); mkdirSync(src);
    writeFileSync(path.join(src, 'x'), 'x');
    const climb = path.join(dir, 'climb.tar.gz');
    execFileSync('tar', ['-czf', climb, '--transform', 's,^x,uploads/../../x,', '-C', src, 'x']);
    await expect(assertSafeUploadsArchive(climb, 'uploads')).rejects.toThrow(/unsafe path/);
    const other = path.join(dir, 'other.tar.gz');
    execFileSync('tar', ['-czf', other, '-C', src, 'x']);
    await expect(assertSafeUploadsArchive(other, 'uploads')).rejects.toThrow(/unsafe path/);
    const abs = path.join(dir, 'abs.tar.gz');
    execFileSync('tar', ['-czf', abs, '-P', '--transform', 's,^x,/tmp/x,', '-C', src, 'x']);
    await expect(assertSafeUploadsArchive(abs, 'uploads')).rejects.toThrow(/unsafe path/);
  });
});
