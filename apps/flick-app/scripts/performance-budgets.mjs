import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
// typescript is a devDependency: this check is a CI/development gate and will
// not run in a tree installed with --omit=dev.
import ts from 'typescript';

/** A failure the operator can act on, reported as a message rather than a stack. */
export class CheckError extends Error {}

// Relative to the app root. These two are the only surfaces allowed to mount a
// <video>; see docs/superpowers/plans/2026-08-17-responsive-layout.md.
export const PLAYBACK_SURFACES = [
  'src/app/player/[id]/PlayerClient.tsx',
  'src/app/(app)/discover/DiscoverClient.tsx',
];

const BUDGET_KEYS = [
  'maxJavaScriptChunkBytes',
  'maxTotalJavaScriptBytes',
  'maxTotalCssBytes',
  'maxPosterBytes',
];

const SCRIPT_KINDS = {
  '.tsx': ts.ScriptKind.TSX,
  '.ts': ts.ScriptKind.TS,
  '.jsx': ts.ScriptKind.JSX,
  '.js': ts.ScriptKind.JS,
};

function toPosix(relative) {
  return relative.split(path.sep).join('/');
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(target) : [target];
    }),
  );
  return nested.flat();
}

async function filesUnderOrExplain(directory, explanation) {
  try {
    await stat(directory);
  } catch (cause) {
    if (cause.code === 'ENOENT') throw new CheckError(explanation, { cause });
    throw new CheckError(`Could not read ${directory}: ${cause.message}`, { cause });
  }

  // Past this point the directory itself exists, so an ENOENT from deeper in
  // the walk is something else -- a concurrent build clearing .next, say -- and
  // must not be reported as "run npm run build".
  try {
    return await filesUnder(directory);
  } catch (cause) {
    throw new CheckError(`Could not read ${directory}: ${cause.message}`, { cause });
  }
}

export async function readBudgets(appRoot) {
  const file = path.join(appRoot, 'performance-budgets.json');
  let raw;

  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    throw new CheckError(`Could not read performance-budgets.json: ${cause.message}`, { cause });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CheckError(`performance-budgets.json is not valid JSON: ${cause.message}`, { cause });
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new CheckError('performance-budgets.json must contain a JSON object');
  }
  return parsed;
}

async function measure(files) {
  return Promise.all(files.map(async (file) => ({ file, bytes: (await stat(file)).size })));
}

export async function measureBuildOutput(appRoot) {
  const chunkDir = path.join(appRoot, '.next', 'static', 'chunks');
  const posterDir = path.join(appRoot, 'public', 'posters');

  const built = await filesUnderOrExplain(
    chunkDir,
    `Missing build output at ${toPosix(path.relative(appRoot, chunkDir))}. Run npm run build before the performance check.`,
  );
  const posterFiles = await filesUnderOrExplain(
    posterDir,
    `Missing poster sources at ${toPosix(path.relative(appRoot, posterDir))}.`,
  );

  return {
    javascript: await measure(built.filter((file) => file.endsWith('.js'))),
    css: await measure(built.filter((file) => file.endsWith('.css'))),
    posters: await measure(posterFiles),
  };
}

function requireBudget(budgets, key) {
  const maximum = budgets[key];
  if (typeof maximum !== 'number' || !Number.isFinite(maximum) || maximum <= 0) {
    throw new CheckError(`performance-budgets.json is missing a positive number for ${key}`);
  }
  return maximum;
}

// An empty set is a broken measurement, not a passing one: -Infinity and 0 both
// sit under every budget, so a build that emitted nowhere we looked would
// otherwise report all-clear.
function judge(label, files, maximum, aggregate) {
  if (files.length === 0) {
    return { label, passed: false, actual: null, maximum, detail: 'measured no files' };
  }
  const actual = aggregate(files.map(({ bytes }) => bytes));
  return actual <= maximum
    ? { label, passed: true, actual, maximum }
    : { label, passed: false, actual, maximum, detail: `exceeded by ${actual - maximum} bytes` };
}

const largest = (sizes) => sizes.reduce((high, size) => (size > high ? size : high), 0);
const total = (sizes) => sizes.reduce((sum, size) => sum + size, 0);

export function evaluateBudgets({ javascript, css, posters }, budgets) {
  const limits = Object.fromEntries(BUDGET_KEYS.map((key) => [key, requireBudget(budgets, key)]));

  return [
    judge('largest JavaScript chunk', javascript, limits.maxJavaScriptChunkBytes, largest),
    judge('total emitted JavaScript', javascript, limits.maxTotalJavaScriptBytes, total),
    judge('total emitted CSS', css, limits.maxTotalCssBytes, total),
    judge('largest source poster', posters, limits.maxPosterBytes, largest),
  ];
}

function isFalse(expression) {
  return expression?.kind === ts.SyntaxKind.FalseKeyword;
}

function isDisabledAttribute(attribute) {
  const { initializer } = attribute;
  return (
    initializer !== undefined && ts.isJsxExpression(initializer) && isFalse(initializer.expression)
  );
}

function isNamed(name, wanted) {
  if (name === undefined) return false;
  if (ts.isIdentifier(name)) return name.escapedText === wanted;
  return ts.isStringLiteral(name) && name.text === wanted;
}

// Parsed rather than grepped: `autoPlay` in a comment, in a string literal, or
// written as autoPlay={false} is not autoplaying media, and a policy a
// regression test cannot mention is a policy nobody can pin down. Object
// properties count too -- `<video {...{ autoPlay: true }} />` autoplays just as
// hard as the attribute, and the playback surfaces are the only files that
// could regress that way unnoticed.
function inspectSource(source, file, scriptKind, videoAllowed) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKind);
  const violations = [];

  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (!videoAllowed && ts.isIdentifier(node.tagName) && node.tagName.escapedText === 'video') {
        violations.push({ file, message: `video element outside playback surfaces: ${file}` });
      }
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          isNamed(attribute.name, 'autoPlay') &&
          !isDisabledAttribute(attribute)
        ) {
          violations.push({ file, message: `autoplay media is forbidden: ${file}` });
        }
      }
    }

    const autoPlayProperty =
      (ts.isPropertyAssignment(node) && isNamed(node.name, 'autoPlay') && !isFalse(node.initializer)) ||
      (ts.isShorthandPropertyAssignment(node) && isNamed(node.name, 'autoPlay'));
    if (autoPlayProperty) {
      violations.push({ file, message: `autoplay media is forbidden: ${file}` });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(parsed, visit);
  return violations;
}

export async function scanMediaPolicy(appRoot) {
  const sourceFiles = await filesUnderOrExplain(
    path.join(appRoot, 'src'),
    `Missing sources at ${toPosix(path.relative(appRoot, path.join(appRoot, 'src')))}.`,
  );
  const violations = [];

  for (const absolute of sourceFiles) {
    const scriptKind = SCRIPT_KINDS[path.extname(absolute)];
    if (scriptKind === undefined) continue;

    const file = toPosix(path.relative(appRoot, absolute));
    violations.push(
      ...inspectSource(await readFile(absolute, 'utf8'), file, scriptKind, PLAYBACK_SURFACES.includes(file)),
    );
  }

  return violations;
}

export function formatReport(results, violations) {
  const lines = results.map(
    ({ label, passed, actual, maximum }) =>
      `${passed ? 'PASS' : 'FAIL'} ${label}: ${actual === null ? 'measured no files' : `${actual} bytes`} (budget ${maximum})`,
  );
  lines.push(`${violations.length === 0 ? 'PASS' : 'FAIL'} playback-only media policy`);

  const errors = [
    ...results.filter(({ passed }) => !passed).map(({ label, detail }) => `${label} ${detail}`),
    ...violations.map(({ message }) => message),
  ];

  return { lines, errors, failed: errors.length > 0 };
}
