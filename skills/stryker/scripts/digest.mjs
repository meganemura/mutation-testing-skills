#!/usr/bin/env node
// Responsibility: turn a Stryker mutation-testing-report-schema 1.x report
// into a record an agent can act on: a survivor list with a stable id, a
// `git apply`-ready patch, the covering tests, and a command that reruns
// just that mutant. A survivor a test never actually ran goes to a
// separate list, so an agent does not mistake a measurement gap for an
// untested line.
// Boundary: this script only reads a report Stryker already wrote. It does
// not run Stryker, and it does not edit source or test files.
//
// No dependency. Node 22+ standard library only.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPORT_PATH = 'reports/mutation/mutation.json';

// A survivor's covering tests can number in the hundreds for code near the
// root of a call graph. Listing every one, for every survivor, produced a
// 44MB digest on solarsql's full report (3,689 survivors): unreadable by an
// agent. These caps keep `tests` to the file an agent actually needs (where
// to add a test), not the full roster.
const MAX_TEST_FILES = 10;
const MAX_TEST_NAMES_PER_FILE = 3;

const STATUS_TO_SUMMARY_KEY = {
  Killed: 'killed',
  Timeout: 'timeout',
  Survived: 'survived',
  NoCoverage: 'no_coverage',
  CompileError: 'compile_error',
  RuntimeError: 'runtime_error',
  Ignored: 'ignored',
  Pending: 'pending',
};

// Control-flow keywords that a naive "name(...) {" scan would otherwise
// mistake for a method name.
const CONTROL_FLOW_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
  'else',
  'function',
  'return',
  'do',
  'try',
  'finally',
]);

const FUNCTION_DECL_RE = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/;
const FUNCTION_EXPR_RE = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*function\b/;
const ARROW_CONST_RE =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/;
const METHOD_RE =
  /^\s*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^{]+)?\{?\s*$/;
const CLASS_RE = /\bclass\s+([A-Za-z_$][\w$]*)/;

/**
 * Finds the function, method, or class member that encloses a source
 * position. Best effort: a regex scan upward from the mutant's line, not a
 * parser. Returns null when no enclosing name is found.
 */
export function findSubject(lines, startLine1based) {
  let methodMatch = null;
  for (let i = startLine1based - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    let m = FUNCTION_DECL_RE.exec(line);
    if (m) return m[1];
    m = FUNCTION_EXPR_RE.exec(line);
    if (m) return m[1];
    if (line.includes('=>')) {
      m = ARROW_CONST_RE.exec(line);
      if (m) return m[1];
    }
    m = METHOD_RE.exec(line);
    if (m && !CONTROL_FLOW_KEYWORDS.has(m[1])) {
      methodMatch = { name: m[1], line: i };
      break;
    }
  }
  if (!methodMatch) return null;
  for (let i = methodMatch.line - 1; i >= 0; i--) {
    const m = CLASS_RE.exec(lines[i] ?? '');
    if (m) return `${m[1]}#${methodMatch.name}`;
  }
  return methodMatch.name;
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** Extracts the source text a location covers (start inclusive, end exclusive). */
export function extractToken(lines, location) {
  const { start, end } = location;
  if (start.line === end.line) {
    const line = lines[start.line - 1] ?? '';
    return collapseWhitespace(line.slice(start.column - 1, end.column - 1));
  }
  const parts = [];
  parts.push((lines[start.line - 1] ?? '').slice(start.column - 1));
  for (let l = start.line + 1; l < end.line; l++) {
    parts.push(lines[l - 1] ?? '');
  }
  parts.push((lines[end.line - 1] ?? '').slice(0, end.column - 1));
  return collapseWhitespace(parts.join(' '));
}

/**
 * Builds a unified-diff hunk for the source range a mutant replaces. Always
 * carries the ",<count>" form, even for a one-line hunk, because `patch`
 * (below) feeds this straight into a `git apply` patch, and the count form
 * is the one both git and diffutils always accept.
 */
export function buildDiff(lines, location, replacement) {
  const { start, end } = location;
  const originalLines = lines.slice(start.line - 1, end.line);
  const firstLine = originalLines[0] ?? '';
  const lastLine = originalLines[originalLines.length - 1] ?? '';
  const prefix = firstLine.slice(0, start.column - 1);
  const suffix = lastLine.slice(end.column - 1);
  const mutatedLines = (prefix + replacement + suffix).split('\n');
  const n = originalLines.length;
  const m = mutatedLines.length;
  const header = `@@ -${start.line},${n} +${start.line},${m} @@`;
  return [
    header,
    ...originalLines.map((l) => `-${l}`),
    ...mutatedLines.map((l) => `+${l}`),
  ].join('\n');
}

/**
 * Builds a `git apply`-ready patch for one mutant: a two-line file header
 * plus `buildDiff`'s hunk, trailing newline included. The hunk carries no
 * context lines, so an agent must apply it with `git apply --unidiff-zero`;
 * plain `git apply` rejects a zero-context hunk unless it matches at the
 * end of the file (verified against real git). Context lines were
 * rejected as the default: they would need clipping at file boundaries and
 * a `\ No newline at end of file` marker for a file with no trailing
 * newline, for a benefit (plain `git apply` support) the digest's own docs
 * can name in one line instead.
 */
export function buildPatch(file, lines, location, replacement) {
  const diff = buildDiff(lines, location, replacement);
  return `--- a/${file}\n+++ b/${file}\n${diff}\n`;
}

/** The first 16 hex digits of a file source's sha256, used to detect a stale `rerun_exact`. */
export function sourceHash(source) {
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

/**
 * Builds the rerun command's mutation range from a report location.
 *
 * The report's columns are 1-based with an exclusive end (verified against
 * a real report: slicing a line with `start.column - 1` to `end.column - 1`
 * yields the exact mutated token). Stryker's `--mutate` range, by contrast,
 * treats its columns as Babel's own 0-based positions: the CLI parser
 * (`project-reader.ts`) reads the column digits with no shift, and the
 * instrumenter's inclusion check (`locationIncluded`) compares that value
 * directly against each AST node's raw, 0-based `loc.start`/`loc.end`. The
 * report writer is the only place a shift happens, adding 1 to both the
 * start and the end column when it builds the report
 * (`object-utils.ts#toSchemaPosition`). So converting a report location
 * into a `--mutate` range means subtracting 1 from both columns, and the
 * line stays the same. Because Stryker's inclusion check accepts a range
 * whose end equals the node's own end, this exact range includes the
 * mutant; it may also include any other mutant inside the same range.
 */
export function rerunExactCommand(file, location) {
  const startColumn = location.start.column - 1;
  const endColumn = location.end.column - 1;
  const range = `${file}:${location.start.line}:${startColumn}-${location.end.line}:${endColumn}`;
  return `npx stryker run --force --mutate "${range}"`;
}

/**
 * Builds the rerun command that survives a source edit: Stryker's own
 * incremental mode, scoped to the mutant's file. Incremental mode
 * realigns a mutant's position from the source diff and retries any
 * surviving mutant in a file whose tests changed, so this stays correct
 * after an agent edits the file; `rerunExactCommand`'s range does not.
 */
export function rerunCommand(file) {
  return `npx stryker run --incremental --mutate "${file}"`;
}

/** Removes a sandbox run's machine-specific and disposable text from a reason string. */
export function sanitizeReason(text, projectRoot) {
  if (text == null) return text;
  let result = text;
  if (projectRoot) {
    result = result.split(`file://${projectRoot}/`).join('');
  }
  result = result.replace(/\.stryker-tmp\/sandbox-[A-Za-z0-9]+\//g, '');
  result = result.replace(/\?[A-Za-z0-9_]+=\d+/g, '');
  return result;
}

function baseIdInput(file, subject, token, operator, replacement) {
  return `${file}\0${subject ?? ''}\0${token}\0${operator}\0${replacement}`;
}

/**
 * Assigns a stable id to every mutant record in one file. Records with the
 * same (file, subject, token, operator, replacement) tuple get an
 * appended, order-of-appearance ordinal before hashing, so the id does not
 * depend on line or column. `records` must already be sorted by source
 * position; that position order, not the report's array order or a
 * survivors-only order, is what keeps an id stable when a status changes
 * elsewhere in the same file.
 */
export function assignIds(file, records) {
  const counts = new Map();
  for (const r of records) {
    const key = baseIdInput(file, r.subject, r.token, r.operator, r.replacement);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map();
  for (const r of records) {
    const key = baseIdInput(file, r.subject, r.token, r.operator, r.replacement);
    let hashInput = key;
    if (counts.get(key) > 1) {
      const ordinal = seen.get(key) ?? 0;
      seen.set(key, ordinal + 1);
      hashInput = `${key}\0${ordinal}`;
    }
    r.id = createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  }
}

function round2(n) {
  return Number(n.toFixed(2));
}

function compareBy(keys) {
  return (a, b) => {
    for (const key of keys) {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  };
}

const byFileLineColumnOperatorReplacement = compareBy([
  (r) => r.file,
  (r) => r._line,
  (r) => r._column,
  (r) => r.operator ?? '',
  (r) => r.replacement ?? '',
]);

function buildTestIndex(testFiles) {
  const index = new Map();
  for (const [file, testFile] of Object.entries(testFiles ?? {})) {
    for (const test of testFile.tests ?? []) {
      index.set(test.id, { name: test.name, file });
    }
  }
  return index;
}

/**
 * Reduces a mutant's covering tests to the file-level summary a `survivors[]`
 * or `unverified[]` entry carries as `tests`: a total count, up to
 * `MAX_TEST_FILES` files (busiest first, ties broken by file name), and up
 * to `MAX_TEST_NAMES_PER_FILE` test names per file (alphabetical). A test's
 * location, even when the report has it, is left out: mixing `name` and
 * `{ name, line }` across entries would give `names[]` two shapes for the
 * same field, so the cap on this array is the only truncation signal.
 */
export function summarizeTests(tests) {
  const total = tests.length;
  const byFile = new Map();
  for (const t of tests) {
    if (!byFile.has(t.file)) byFile.set(t.file, []);
    byFile.get(t.file).push(t.name);
  }
  const fileGroups = [...byFile.entries()].map(([file, names]) => ({
    file,
    count: names.length,
    names: [...names].sort(),
  }));
  fileGroups.sort(compareBy([(f) => -f.count, (f) => f.file]));

  let truncated = fileGroups.length > MAX_TEST_FILES;
  const files = fileGroups.slice(0, MAX_TEST_FILES).map((f) => {
    if (f.names.length > MAX_TEST_NAMES_PER_FILE) truncated = true;
    return { file: f.file, count: f.count, names: f.names.slice(0, MAX_TEST_NAMES_PER_FILE) };
  });

  return { total, truncated, files };
}

/** Reads the schema's `MutationTestResult` and builds the agent digest. */
export function buildDigest(report) {
  if (typeof report.schemaVersion !== 'string' || !report.schemaVersion.startsWith('1.')) {
    throw new UsageError(
      `unsupported report_schema_version: ${String(report.schemaVersion)}`,
    );
  }

  const projectRoot = report.projectRoot;
  const disableBail = report.config?.disableBail ?? false;
  const testIndex = buildTestIndex(report.testFiles);

  const statusCounts = {
    killed: 0,
    timeout: 0,
    survived: 0,
    no_coverage: 0,
    compile_error: 0,
    runtime_error: 0,
    ignored: 0,
    pending: 0,
  };

  const survivors = [];
  const unverified = [];
  const noCoverage = [];
  const timeouts = [];
  const invalid = [];
  const ignored = [];
  const perSource = [];
  const killedTestIds = new Set();
  let unverifiedCount = 0;

  for (const [file, fileReport] of Object.entries(report.files ?? {})) {
    const lines = fileReport.source.split('\n');
    const fileSourceHash = sourceHash(fileReport.source);

    const records = (fileReport.mutants ?? [])
      .map((mutant) => ({
        mutant,
        file,
        _line: mutant.location.start.line,
        _column: mutant.location.start.column,
        subject: findSubject(lines, mutant.location.start.line),
        token: extractToken(lines, mutant.location),
        operator: mutant.mutatorName,
        replacement: mutant.replacement ?? '',
      }))
      .sort(compareBy([(r) => r._line, (r) => r._column]));
    assignIds(file, records);

    const perSourceCounts = {
      total: 0,
      killed: 0,
      timeout: 0,
      survived: 0,
      no_coverage: 0,
    };

    for (const r of records) {
      const { mutant } = r;
      const summaryKey = STATUS_TO_SUMMARY_KEY[mutant.status];
      if (summaryKey) statusCounts[summaryKey] += 1;
      perSourceCounts.total += 1;
      if (summaryKey && summaryKey in perSourceCounts) {
        perSourceCounts[summaryKey] += 1;
      }
      for (const testId of mutant.killedBy ?? []) killedTestIds.add(testId);

      if (mutant.status === 'Survived') {
        const tests = summarizeTests(
          (mutant.coveredBy ?? []).map((id) => testIndex.get(id)).filter(Boolean),
        );
        // Survived, covered, and yet not one covering test actually ran: a
        // measurement gap (the vitest-runner 10.0.0 / Vitest 5 pairing hit
        // this, stryker-js issue #6210), not a missing test. Route it away
        // from survivors[] so an agent does not spend a test-writing pass
        // on a mutant no test tried.
        const isUnverified = (mutant.coveredBy?.length ?? 0) > 0 && mutant.testsCompleted === 0;
        if (isUnverified) unverifiedCount += 1;
        const entry = {
          subject: r.subject,
          file,
          line: r._line,
          location: mutant.location,
          operator: r.operator,
          id: r.id,
          replacement: r.replacement,
          patch: buildPatch(file, lines, mutant.location, r.replacement),
          source_hash: fileSourceHash,
          tests,
          rerun: rerunCommand(file),
          rerun_exact: rerunExactCommand(file, mutant.location),
          _line: r._line,
          _column: r._column,
        };
        (isUnverified ? unverified : survivors).push(entry);
      } else if (mutant.status === 'NoCoverage') {
        noCoverage.push({
          subject: r.subject,
          file,
          line: r._line,
          id: r.id,
          operator: r.operator,
          token: r.token,
          _line: r._line,
          _column: r._column,
        });
      } else if (mutant.status === 'Timeout') {
        timeouts.push({
          subject: r.subject,
          file,
          line: r._line,
          id: r.id,
          operator: r.operator,
          token: r.token,
          status_reason: sanitizeReason(mutant.statusReason, projectRoot),
          _line: r._line,
          _column: r._column,
        });
      } else if (mutant.status === 'CompileError' || mutant.status === 'RuntimeError') {
        invalid.push({
          subject: r.subject,
          file,
          line: r._line,
          id: r.id,
          status: mutant.status,
          status_reason: sanitizeReason(mutant.statusReason, projectRoot),
          _line: r._line,
          _column: r._column,
        });
      } else if (mutant.status === 'Ignored') {
        ignored.push({
          subject: r.subject,
          file,
          line: r._line,
          id: r.id,
          operator: r.operator,
          token: r.token,
          reason: sanitizeReason(mutant.statusReason, projectRoot),
          _line: r._line,
          _column: r._column,
        });
      }
    }

    const detected = perSourceCounts.killed + perSourceCounts.timeout;
    const valid = detected + perSourceCounts.survived + perSourceCounts.no_coverage;
    perSource.push({
      file,
      total: perSourceCounts.total,
      killed: perSourceCounts.killed,
      timeout: perSourceCounts.timeout,
      survived: perSourceCounts.survived,
      no_coverage: perSourceCounts.no_coverage,
      score: valid ? round2((detected / valid) * 100) : null,
    });
  }

  const testsWithoutKills = [];
  for (const [file, testFile] of Object.entries(report.testFiles ?? {})) {
    for (const test of testFile.tests ?? []) {
      if (!killedTestIds.has(test.id)) {
        testsWithoutKills.push({ name: test.name, file });
      }
    }
  }
  testsWithoutKills.sort(compareBy([(t) => t.file, (t) => t.name]));

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const detected = statusCounts.killed + statusCounts.timeout;
  const validTotal = detected + statusCounts.survived + statusCounts.no_coverage;
  const coveredTotal = detected + statusCounts.survived;
  // Stryker counts an unverified mutant as survived, so `score` and
  // `score_covered` above are unchanged. This second score answers "how
  // good is the suite, once the measurement gap itself is set aside".
  const validExcludingUnverified = validTotal - unverifiedCount;

  const stripInternal = (r) => {
    const { _line, _column, ...rest } = r;
    return rest;
  };

  survivors.sort(byFileLineColumnOperatorReplacement);
  unverified.sort(byFileLineColumnOperatorReplacement);
  noCoverage.sort(byFileLineColumnOperatorReplacement);
  timeouts.sort(byFileLineColumnOperatorReplacement);
  invalid.sort(byFileLineColumnOperatorReplacement);
  ignored.sort(byFileLineColumnOperatorReplacement);
  perSource.sort(compareBy([(r) => r.file]));

  return {
    schema_version: '3.0',
    source: {
      tool: 'stryker',
      report_schema_version: report.schemaVersion,
      disable_bail: disableBail,
    },
    summary: {
      total,
      killed: statusCounts.killed,
      timeout: statusCounts.timeout,
      survived: statusCounts.survived,
      no_coverage: statusCounts.no_coverage,
      compile_error: statusCounts.compile_error,
      runtime_error: statusCounts.runtime_error,
      ignored: statusCounts.ignored,
      pending: statusCounts.pending,
      unverified: unverifiedCount,
      score: validTotal ? round2((detected / validTotal) * 100) : null,
      score_covered: coveredTotal ? round2((detected / coveredTotal) * 100) : null,
      score_excluding_unverified: validExcludingUnverified
        ? round2((detected / validExcludingUnverified) * 100)
        : null,
    },
    survivors: survivors.map(stripInternal),
    unverified: unverified.map(stripInternal),
    no_coverage: noCoverage.map(stripInternal),
    timeouts: timeouts.map(stripInternal),
    invalid: invalid.map(stripInternal),
    ignored: ignored.map(stripInternal),
    per_source: perSource,
    tests_without_kills: testsWithoutKills,
  };
}

// mutineer's `survivors[]` keys were the model for `subject`, `file`,
// `line`, `operator`, and `id`; `token` matched a baseline survivor by its
// source text once, but a survivor no longer carries `token` (see
// `patch`), so a baseline match stays on `id` alone.
const BASELINE_KEYS = ['subject', 'file', 'line', 'operator', 'id'];

function pickBaselineFields(entry) {
  const picked = {};
  for (const key of BASELINE_KEYS) picked[key] = entry[key];
  return picked;
}

/** Compares a digest's survivors against a previous digest's survivors, by id. */
export function compareBaseline(digest, baselineDigest) {
  const currentIds = new Map(digest.survivors.map((s) => [s.id, s]));
  const baselineIds = new Map(
    (baselineDigest.survivors ?? []).map((s) => [s.id, s]),
  );
  const newSurvivors = [...currentIds.values()]
    .filter((s) => !baselineIds.has(s.id))
    .map(pickBaselineFields)
    .sort(byFileLineColumnOperatorReplacement);
  // A survivor that moved to unverified[] ran no test this time, so its
  // absence from survivors[] says nothing about a fix.
  const unverifiedIds = new Set((digest.unverified ?? []).map((s) => s.id));
  const fixedSurvivors = [...baselineIds.values()]
    .filter((s) => !currentIds.has(s.id) && !unverifiedIds.has(s.id))
    .map(pickBaselineFields)
    .sort(byFileLineColumnOperatorReplacement);
  return { new_survivors: newSurvivors, fixed_survivors: fixedSurvivors };
}

function fmtScore(n) {
  return n === null ? 'null' : String(n);
}

/** Renders the digest as the short, per-survivor text an agent reads directly. */
export function formatText(digest) {
  const lines = [];
  for (const s of digest.survivors) {
    lines.push(`${s.file}:${s.line} ${s.subject ?? '(unknown)'} ${s.operator} ${s.id}`);
    // `s.patch` carries a trailing newline for `git apply`; trim it here so
    // the text block does not gain a stray blank line before `rerun`.
    lines.push(s.patch.trimEnd());
    lines.push(s.rerun);
    lines.push(s.rerun_exact);
    lines.push('');
  }
  const sm = digest.summary;
  lines.push(
    `summary: total=${sm.total} killed=${sm.killed} timeout=${sm.timeout} ` +
      `survived=${sm.survived} no_coverage=${sm.no_coverage} ` +
      `compile_error=${sm.compile_error} runtime_error=${sm.runtime_error} ` +
      `ignored=${sm.ignored} pending=${sm.pending} unverified=${sm.unverified} ` +
      `score=${fmtScore(sm.score)} score_covered=${fmtScore(sm.score_covered)} ` +
      `score_excluding_unverified=${fmtScore(sm.score_excluding_unverified)}`,
  );
  if (digest.unverified.length > 0) {
    lines.push(
      `${digest.unverified.length} survivors ran no test; fix the measurement first. See unverified[].`,
    );
  }
  return lines.join('\n');
}

export class UsageError extends Error {}

function readJsonFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new UsageError(`cannot parse ${path} as JSON: ${err.message}`);
  }
}

/**
 * Runs the CLI end to end and returns its output and exit code, without
 * calling `process.exit`. Kept separate from `main()` so tests can call it
 * in-process.
 */
export function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        baseline: { type: 'string' },
        format: { type: 'string', default: 'json' },
        output: { type: 'string' },
      },
    });
  } catch (err) {
    return { exitCode: 2, stderr: `usage error: ${err.message}\n`, stdout: '' };
  }

  const reportPath = parsed.positionals[0] ?? DEFAULT_REPORT_PATH;
  const format = parsed.values.format;
  if (format !== 'json' && format !== 'text') {
    return { exitCode: 2, stderr: `usage error: unknown --format ${format}\n`, stdout: '' };
  }

  let digest;
  try {
    const report = readJsonFile(reportPath);
    digest = buildDigest(report);
    if (parsed.values.baseline) {
      const baselineDigest = readJsonFile(parsed.values.baseline);
      digest.baseline = compareBaseline(digest, baselineDigest);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return { exitCode: 2, stderr: `usage error: ${err.message}\n`, stdout: '' };
    }
    throw err;
  }

  const body = format === 'text' ? formatText(digest) : JSON.stringify(digest);
  const output = `${body}\n`;

  if (parsed.values.output) {
    writeFileSync(parsed.values.output, output);
  }

  const exitCode = digest.baseline && digest.baseline.new_survivors.length > 0 ? 1 : 0;
  return {
    exitCode,
    stdout: parsed.values.output ? '' : output,
    stderr: '',
  };
}

function main() {
  const result = run(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
