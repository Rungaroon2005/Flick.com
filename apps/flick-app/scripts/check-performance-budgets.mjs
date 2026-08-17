import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgets = JSON.parse(await readFile(path.join(appRoot, 'performance-budgets.json'), 'utf8'));
const failures = [];

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

async function measure(files) {
  return Promise.all(files.map(async (file) => ({ file, bytes: (await stat(file)).size })));
}

function enforce(label, actual, maximum) {
  const passed = actual <= maximum;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: ${actual} bytes (budget ${maximum})`);
  if (!passed) failures.push(`${label} exceeded by ${actual - maximum} bytes`);
}

let builtFiles;
try {
  builtFiles = await filesUnder(path.join(appRoot, '.next', 'static', 'chunks'));
} catch {
  throw new Error('Missing .next build output. Run npm run build before the performance check.');
}

const javascript = await measure(builtFiles.filter((file) => file.endsWith('.js')));
const css = await measure(builtFiles.filter((file) => file.endsWith('.css')));
const posters = await measure(await filesUnder(path.join(appRoot, 'public', 'posters')));

enforce('largest JavaScript chunk', Math.max(...javascript.map(({ bytes }) => bytes)), budgets.maxJavaScriptChunkBytes);
enforce('total emitted JavaScript', javascript.reduce((total, { bytes }) => total + bytes, 0), budgets.maxTotalJavaScriptBytes);
enforce('total emitted CSS', css.reduce((total, { bytes }) => total + bytes, 0), budgets.maxTotalCssBytes);
enforce('largest source poster', Math.max(...posters.map(({ bytes }) => bytes)), budgets.maxPosterBytes);

const sourceFiles = (await filesUnder(path.join(appRoot, 'src'))).filter((file) => /\.(tsx?|jsx?)$/.test(file));
const allowedVideoComponents = new Set([
  path.join(appRoot, 'src', 'app', 'player', '[id]', 'PlayerClient.tsx'),
  path.join(appRoot, 'src', 'app', '(app)', 'discover', 'DiscoverClient.tsx'),
]);

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  if (/\bautoPlay\b/.test(source)) failures.push(`autoplay media is forbidden: ${path.relative(appRoot, file)}`);
  if (/<video\b/.test(source) && !allowedVideoComponents.has(file)) {
    failures.push(`video element outside playback surfaces: ${path.relative(appRoot, file)}`);
  }
}

console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} playback-only media policy`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
