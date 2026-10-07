import { lstat, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

/** Refuse symlink destinations, including intermediate directories, before scaffolding. */
export async function projectPath(root: string, target: string): Promise<string> {
  const base = await realpath(root);
  const full = resolve(base, target);
  const rel = relative(base, full);
  if (rel === '..' || rel.startsWith('..' + sep) || rel === '')
    throw new Error('Destination must be inside the project directory');
  let current = base;
  const parts = rel.split(sep);
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]!);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info?.isSymbolicLink()) throw new Error(`Refusing symbolic-link destination: ${target}`);
    if (info && i < parts.length - 1 && !info.isDirectory())
      throw new Error(`Destination parent is not a directory: ${target}`);
  }
  return full;
}
