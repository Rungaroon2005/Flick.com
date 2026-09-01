import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluateBudgets,
  formatReport,
  measureBuildOutput,
  scanMediaPolicy,
} from './performance-budgets.mjs';

// These tests live in scripts/ rather than src/ on purpose: scanMediaPolicy
// walks src/, so a fixture containing `autoPlay` placed there would be flagged
// by the very policy it is meant to test.

const budgets = {
  maxJavaScriptChunkBytes: 640_000,
  maxTotalJavaScriptBytes: 1_700_000,
  maxTotalCssBytes: 80_000,
  maxPosterBytes: 1_100_000,
};

const createdRoots = [];

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Build a throwaway app root: `chunks`/`posters` map name → byte size, `src` maps path → source. */
async function makeAppRoot({ chunks = {}, posters = {}, src = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'flick-perf-'));
  createdRoots.push(root);

  const chunkDir = path.join(root, '.next', 'static', 'chunks');
  const posterDir = path.join(root, 'public', 'posters');
  await mkdir(chunkDir, { recursive: true });
  await mkdir(posterDir, { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });

  for (const [name, size] of Object.entries(chunks)) {
    await writeFile(path.join(chunkDir, name), 'x'.repeat(size));
  }
  for (const [name, size] of Object.entries(posters)) {
    await writeFile(path.join(posterDir, name), 'x'.repeat(size));
  }
  for (const [relative, source] of Object.entries(src)) {
    const file = path.join(root, 'src', relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
  }

  return root;
}

function measurements({ javascript = [], css = [], posters = [] } = {}) {
  return { javascript, css, posters };
}

function resultFor(results, label) {
  const result = results.find((entry) => entry.label === label);
  if (!result) throw new Error(`no result labelled "${label}"`);
  return result;
}

describe('evaluateBudgets', () => {
  it('fails the chunk budget when no JavaScript was measured', () => {
    const results = evaluateBudgets(
      measurements({ posters: [{ file: 'a.jpg', bytes: 10 }] }),
      budgets,
    );

    expect(resultFor(results, 'largest JavaScript chunk').passed).toBe(false);
    expect(resultFor(results, 'total emitted JavaScript').passed).toBe(false);
  });

  it('fails the poster budget when no posters were measured', () => {
    const results = evaluateBudgets(
      measurements({ javascript: [{ file: 'a.js', bytes: 10 }], css: [{ file: 'a.css', bytes: 10 }] }),
      budgets,
    );

    expect(resultFor(results, 'largest source poster').passed).toBe(false);
  });

  it('reports an unmeasured budget as measuring nothing, not as zero bytes', () => {
    const results = evaluateBudgets(measurements(), budgets);

    expect(resultFor(results, 'total emitted CSS').detail).toMatch(/measured no files/);
  });

  it('passes a budget the measured files sit under', () => {
    const results = evaluateBudgets(
      measurements({
        javascript: [{ file: 'a.js', bytes: 100 }],
        css: [{ file: 'a.css', bytes: 100 }],
        posters: [{ file: 'a.jpg', bytes: 100 }],
      }),
      budgets,
    );

    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('names the offending key when a budget is missing from the config', () => {
    const incomplete = { ...budgets };
    delete incomplete.maxTotalCssBytes;

    expect(() =>
      evaluateBudgets(
        measurements({
          javascript: [{ file: 'a.js', bytes: 1 }],
          css: [{ file: 'a.css', bytes: 1 }],
          posters: [{ file: 'a.jpg', bytes: 1 }],
        }),
        incomplete,
      ),
    ).toThrow(/maxTotalCssBytes/);
  });
});

describe('formatReport', () => {
  it('keeps the media policy line PASS when only a budget failed', () => {
    const results = evaluateBudgets(
      measurements({
        javascript: [{ file: 'a.js', bytes: 100 }],
        css: [{ file: 'a.css', bytes: 85_000 }],
        posters: [{ file: 'a.jpg', bytes: 100 }],
      }),
      budgets,
    );

    const report = formatReport(results, []);

    expect(report.lines).toContain('PASS playback-only media policy');
    expect(report.failed).toBe(true);
  });

  it('fails the media policy line when a violation was found', () => {
    const results = evaluateBudgets(
      measurements({
        javascript: [{ file: 'a.js', bytes: 100 }],
        css: [{ file: 'a.css', bytes: 100 }],
        posters: [{ file: 'a.jpg', bytes: 100 }],
      }),
      budgets,
    );

    const report = formatReport(results, [{ file: 'src/Rogue.tsx', message: 'autoplay media is forbidden: src/Rogue.tsx' }]);

    expect(report.lines).toContain('FAIL playback-only media policy');
    expect(report.errors).toContain('autoplay media is forbidden: src/Rogue.tsx');
  });
});

describe('scanMediaPolicy', () => {
  it('flags an autoplaying video', async () => {
    const root = await makeAppRoot({
      src: { 'app/player/[id]/PlayerClient.tsx': '<video autoPlay src={url} />' },
    });

    const violations = await scanMediaPolicy(root);

    expect(violations.map(({ file }) => file)).toEqual(['src/app/player/[id]/PlayerClient.tsx']);
  });

  it('ignores autoPlay named in a comment', async () => {
    const root = await makeAppRoot({
      src: { 'components/Hero.tsx': '// The hero must never autoPlay its trailer.\nexport const Hero = () => null;' },
    });

    expect(await scanMediaPolicy(root)).toEqual([]);
  });

  it('ignores autoPlay named in a string literal', async () => {
    const root = await makeAppRoot({
      src: { 'components/Hero.test.tsx': "expect(video).not.toHaveAttribute('autoPlay');" },
    });

    expect(await scanMediaPolicy(root)).toEqual([]);
  });

  it('accepts autoPlay explicitly disabled', async () => {
    const root = await makeAppRoot({
      src: { 'app/player/[id]/PlayerClient.tsx': '<video autoPlay={false} src={url} />' },
    });

    expect(await scanMediaPolicy(root)).toEqual([]);
  });

  it('flags autoplay routed through spread props', async () => {
    const root = await makeAppRoot({
      src: {
        'app/player/[id]/PlayerClient.tsx':
          'const videoProps = { autoPlay: true };\nexport const P = () => <video {...videoProps} />;',
      },
    });

    const violations = await scanMediaPolicy(root);

    expect(violations.map(({ file }) => file)).toEqual(['src/app/player/[id]/PlayerClient.tsx']);
  });

  it('flags autoplay passed as a shorthand property', async () => {
    const root = await makeAppRoot({
      src: {
        'app/player/[id]/PlayerClient.tsx':
          'export const P = ({ autoPlay }) => <video {...{ autoPlay }} />;',
      },
    });

    expect(await scanMediaPolicy(root)).toHaveLength(1);
  });

  it('accepts an autoPlay property explicitly set to false', async () => {
    const root = await makeAppRoot({
      src: { 'app/player/[id]/PlayerClient.tsx': 'const videoProps = { autoPlay: false };' },
    });

    expect(await scanMediaPolicy(root)).toEqual([]);
  });

  it('ignores autoPlay declared as an optional prop type', async () => {
    const root = await makeAppRoot({
      src: { 'components/ui/Player.tsx': 'type Props = { autoPlay?: boolean };\nexport type { Props };' },
    });

    expect(await scanMediaPolicy(root)).toEqual([]);
  });

  it('allows a video element in the two playback surfaces', async () => {
    const root = await makeAppRoot({
      src: {
        'app/player/[id]/PlayerClient.tsx': '<video ref={ref} />',
        'app/(app)/discover/DiscoverClient.tsx': '<video ref={ref} />',
      },
    });

    expect(await scanMediaPolicy(root)).toEqual([]);
  });

  it('flags a video element outside the playback surfaces', async () => {
    const root = await makeAppRoot({
      src: { 'components/ui/Teaser.tsx': '<video ref={ref} />' },
    });

    const violations = await scanMediaPolicy(root);

    expect(violations.map(({ file }) => file)).toEqual(['src/components/ui/Teaser.tsx']);
  });
});

describe('measureBuildOutput', () => {
  it('measures the emitted chunks and the source posters', async () => {
    const root = await makeAppRoot({
      chunks: { 'page.js': 300, 'main.css': 120 },
      posters: { 'dao.jpg': 900 },
    });

    const measured = await measureBuildOutput(root);

    expect(measured.javascript).toEqual([{ file: path.join(root, '.next/static/chunks/page.js'), bytes: 300 }]);
    expect(measured.css.map(({ bytes }) => bytes)).toEqual([120]);
    expect(measured.posters.map(({ bytes }) => bytes)).toEqual([900]);
  });

  it('asks for a build when the build output is missing', async () => {
    const root = await makeAppRoot();
    await rm(path.join(root, '.next'), { recursive: true });

    await expect(measureBuildOutput(root)).rejects.toThrow(/npm run build/);
  });

  it('names the posters directory when it is the one missing', async () => {
    const root = await makeAppRoot({ chunks: { 'page.js': 10 } });
    await rm(path.join(root, 'public', 'posters'), { recursive: true });

    await expect(measureBuildOutput(root)).rejects.toThrow(/public\/posters/);
  });
});
