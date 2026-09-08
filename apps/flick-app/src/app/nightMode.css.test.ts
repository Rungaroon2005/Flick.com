import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// process.cwd() is the flick-app package root under vitest, per
// vitest.config.mts's '@' alias resolving from ./src the same way.
const CSS_PATH = resolve(process.cwd(), 'src/app/globals.css');

const FORBIDDEN_PROPERTIES = ['filter', 'opacity', 'backdrop-filter'];

/**
 * Extracts the { ... } body of the FIRST `:root[data-night="on"]` rule by
 * counting braces from the selector, rather than a single regex — the block
 * legitimately contains nested functions like rgba(...) whose parens a naive
 * "match to the next }" regex would not need to worry about, but being
 * explicit about brace-counting keeps this correct if the block ever grows
 * a nested at-rule.
 */
function extractNightModeBlock(css: string): string {
  const selectorIndex = css.indexOf(':root[data-night="on"]');
  if (selectorIndex === -1) {
    throw new Error('No :root[data-night="on"] rule found in globals.css');
  }
  const openBrace = css.indexOf('{', selectorIndex);
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  throw new Error('Unbalanced braces in :root[data-night="on"] rule');
}

describe('night mode CSS scope', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const block = extractNightModeBlock(css);

  it.each(FORBIDDEN_PROPERTIES)(
    'never declares %s -- it would reach the <video> element too',
    (property) => {
      // A page-level filter/opacity/backdrop-filter dims EVERYTHING inside
      // its containing block, the film included, and there is no clean way
      // to punch a hole back through it for just the <video>. Custom
      // property overrides cannot reach the video by construction (it
      // renders decoded frames, not CSS colors) -- this test is what keeps
      // that boundary from being crossed by a later, well-intentioned edit.
      const declared = new RegExp(`(^|[;{\\s])${property}\\s*:`, 'i').test(block);
      expect(declared).toBe(false);
    },
  );

  it('overrides at least the core foreground and brand tokens', () => {
    // Loose on purpose -- this is a floor, not a full spec of the palette,
    // so the block can grow without this test needing to grow with it.
    for (const token of ['--color-fg', '--color-brand', '--color-subtitle']) {
      expect(block).toContain(token);
    }
  });
});
