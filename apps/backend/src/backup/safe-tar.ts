import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * A backup's uploads archive is read back from storage (an S3 bucket whose settings a backup manager can change),
 * so it is not trusted: before it is extracted it must contain only regular files and directories, all inside the
 * one expected top-level folder, with no absolute or `..` paths and no links (a symlink or hard link inside an
 * archive can make a later entry write outside the target).
 */
export async function assertSafeUploadsArchive(archivePath: string, rootName: string): Promise<void> {
  const opts = { maxBuffer: 64 * 1024 * 1024 };
  const { stdout: names } = await execFileAsync('tar', ['-tzf', archivePath], opts);
  for (const raw of names.split('\n')) {
    const name = raw.trim();
    if (!name) continue;
    const parts = name.split('/').filter((p) => p !== '');
    if (name.startsWith('/') || parts.includes('..') || parts[0] !== rootName || name.includes('\0')) {
      throw new Error(`The uploads archive holds an unsafe path (${JSON.stringify(name).slice(0, 120)}); it was not restored.`);
    }
  }
  const { stdout: verbose } = await execFileAsync('tar', ['-tzvf', archivePath], opts);
  for (const line of verbose.split('\n')) {
    const kind = line[0];
    if (!line) continue;
    if (kind !== '-' && kind !== 'd') {
      throw new Error('The uploads archive holds a link or special file; it was not restored.');
    }
  }
}

/** Extraction flags that stop the archive from changing ownership or permissions on the host. */
export const SAFE_EXTRACT_FLAGS = ['--no-same-owner', '--no-same-permissions'] as const;
