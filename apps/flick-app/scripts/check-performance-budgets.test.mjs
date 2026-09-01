import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const cli = path.join(import.meta.dirname, 'check-performance-budgets.mjs');

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

async function makeAppRoot({ chunks = {}, posters = { 'dao.jpg': 900 } } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'flick-cli-'));
  createdRoots.push(root);

  const chunkDir = path.join(root, '.next', 'static', 'chunks');
  const posterDir = path.join(root, 'public', 'posters');
  await mkdir(chunkDir, { recursive: true });
  await mkdir(posterDir, { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'performance-budgets.json'), JSON.stringify(budgets));

  for (const [name, size] of Object.entries(chunks)) {
    await writeFile(path.join(chunkDir, name), 'x'.repeat(size));
  }
  for (const [name, size] of Object.entries(posters)) {
    await writeFile(path.join(posterDir, name), 'x'.repeat(size));
  }

  return root;
}

/** Run the CLI against a throwaway app root and normalise its result. */
async function check(root) {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, root]);
    return { code: 0, stdout, stderr };
  } catch (failure) {
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

describe('check-performance-budgets', () => {
  it('is where the tests expect to find it', async () => {
    await expect(access(cli)).resolves.toBeUndefined();
  });

  it('passes a build that sits under every budget', async () => {
    const root = await makeAppRoot({ chunks: { 'page.js': 1000, 'main.css': 1000 } });

    const { code, stdout } = await check(root);

    expect(code).toBe(0);
    expect(stdout).toContain('PASS total emitted CSS: 1000 bytes (budget 80000)');
    expect(stdout).toContain('PASS playback-only media policy');
  });

  it('fails a busted budget without blaming the media policy', async () => {
    const root = await makeAppRoot({ chunks: { 'page.js': 1000, 'main.css': 85_000 } });

    const { code, stdout, stderr } = await check(root);

    expect(code).toBe(1);
    expect(stdout).toContain('FAIL total emitted CSS: 85000 bytes (budget 80000)');
    expect(stdout).toContain('PASS playback-only media policy');
    expect(stderr).toContain('total emitted CSS exceeded by 5000 bytes');
  });

  it('fails rather than passing a build that emitted nothing it could measure', async () => {
    const root = await makeAppRoot();

    const { code, stdout } = await check(root);

    expect(code).toBe(1);
    expect(stdout).toContain('FAIL largest JavaScript chunk: measured no files (budget 640000)');
  });

  it('reports a malformed budgets file without a stack trace', async () => {
    const root = await makeAppRoot({ chunks: { 'page.js': 10 } });
    await writeFile(path.join(root, 'performance-budgets.json'), '{ not json');

    const { code, stderr } = await check(root);

    expect(code).toBe(1);
    expect(stderr).toContain('performance-budgets.json');
    expect(stderr).not.toMatch(/^\s+at /m);
  });

  it('keeps the stack for a failure it does not recognise', async () => {
    const root = await makeAppRoot({ chunks: { 'page.js': 10 } });
    await symlink(path.join(root, 'src', 'nowhere.tsx'), path.join(root, 'src', 'broken.tsx'));

    const { code, stderr } = await check(root);

    expect(code).toBe(1);
    expect(stderr).toMatch(/^\s+at /m);
  });

  it('asks for a build instead of printing a stack trace when the output is missing', async () => {
    const root = await makeAppRoot();
    await rm(path.join(root, '.next'), { recursive: true });

    const { code, stderr } = await check(root);

    expect(code).toBe(1);
    expect(stderr).toContain('Run npm run build before the performance check.');
    expect(stderr).not.toMatch(/^\s+at /m); // no stack frames
  });
});
