import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  CheckError,
  evaluateBudgets,
  formatReport,
  measureBuildOutput,
  readBudgets,
  scanMediaPolicy,
} from './performance-budgets.mjs';

// Defaults to the app this script ships in; an explicit root keeps the whole
// pipeline exercisable against a fixture build.
const appRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const budgets = await readBudgets(appRoot);
  const results = evaluateBudgets(await measureBuildOutput(appRoot), budgets);
  const { lines, errors, failed } = formatReport(results, await scanMediaPolicy(appRoot));

  for (const line of lines) console.log(line);
  if (failed) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
} catch (failure) {
  // Anything we did not classify is a defect in this script, not an operator
  // error: let it keep its stack rather than masquerading as a budget failure.
  if (!(failure instanceof CheckError)) throw failure;
  console.error(failure.message);
  process.exitCode = 1;
}
