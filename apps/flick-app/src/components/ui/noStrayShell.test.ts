import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vitest runs this as ESM, where __dirname does not exist. vitest.config.ts
// resolves paths the same way.
const here = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const target = path.join(dir, entry);
    if (statSync(target).isDirectory()) return sourceFiles(target);
    return /\.tsx$/.test(target) ? [target] : [];
  });
}

/**
 * The bottom-nav offset must live in exactly one place. Nine copies is how
 * it got out of sync in the first place, and a stray copy silently keeps
 * 96px of dead space at desktop width where the bottom nav does not exist.
 */
describe('page shell', () => {
  it('has no hand-rolled bottom-nav offsets left', () => {
    const offenders = sourceFiles(path.resolve(here, '../../'))
      // Excludes PageShell.tsx (the real implementation, which legitimately
      // contains the string) AND PageShell.test.tsx (Task 1's test asserts
      // the string as a literal) — endsWith('PageShell.tsx') alone matches
      // only the former and leaves the latter to trip this test forever.
      .filter((file) => !path.basename(file).startsWith('PageShell'))
      .filter((file) => readFileSync(file, 'utf8').includes('pb-[calc(96px+env(safe-area-inset-bottom))]'))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
