#!/usr/bin/env node
// Responsibility: turn a Stryker mutation-testing-report-schema 1.x report
// into a record an agent can act on: a survivor list with a stable id, a
// `git apply`-ready patch, the covering tests, and a command that reruns
// just that mutant. A survivor a test never actually ran goes to a
// separate list, so an agent does not mistake a measurement gap for an
// untested line. `--since` narrows that record to the lines a git ref
// changed, and `--gate` turns it into a pass/fail check, so the same
// script serves a PR's changed-line gate as well as a full local read.
// Boundary: this script only reads a report Stryker already wrote, plus,
// with `--since`, the working tree's current file content and `git diff`
// output. It does not run Stryker, and it does not edit source or test
// files.
//
// No dependency. Node 22+ standard library only.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPORT_PATH = 'reports/mutation/mutation.json';

// A survivor's covering tests can number in the hundreds for code near the
// root of a call graph. Listing every one, for every survivor, produced a
// 44MB digest on one project's full report (3,689 survivors): unreadable by an
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

/**
 * The full text of every line a mutant's location spans, each line
 * trimmed of its own leading and trailing whitespace and, for a
 * multi-line span, joined with "\n". Used as id material instead of the
 * mutated token alone: on a 14,140-mutant report, (file, token, operator,
 * replacement) collided for 30% of mutants (the same token appears at
 * unrelated call sites); a line's full text narrowed that to 8%, because
 * it usually pins a mutant to one call site even when the token repeats
 * within the line.
 */
export function lineText(lines, location) {
  const spanned = lines.slice(location.start.line - 1, location.end.line);
  return spanned.map((l) => (l ?? '').trim()).join('\n');
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

function baseIdInput(file, lineTextValue, token, operator, replacement) {
  return `${file}\0${lineTextValue}\0${token}\0${operator}\0${replacement}`;
}

/**
 * Assigns a stable id to every mutant record in one file, from material a
 * report and a reporter can both compute the same way: file, the
 * enclosing line's full text (`lineText`, above), the mutated text
 * (`token`), the operator, and the replacement. `subject` (the enclosing
 * function or method name) is left out on purpose: the line text already
 * carries most of its distinguishing power, and without `subject`, a
 * report's digest and a reporter running live inside Stryker compute
 * the same id straight from the same report fields.
 *
 * Neither ordinal below is a raw line or column number: both would shift
 * with unrelated indentation or an edit elsewhere in the file, which is
 * exactly the instability this id exists to avoid. Two ordinals break a
 * tie instead, in this order:
 *
 * 1. `_columnOrdinal`: among mutants on the *same physical line* that
 *    share (line text, token, operator, replacement), the order by
 *    column. A line can carry two mutable spots with an identical
 *    rewrite (`total + step + step`, both `+`s flipped to `-`).
 * 2. `_occurrenceOrdinal`: among mutants whose (line text, token,
 *    operator, replacement, column ordinal) still match after 1, the
 *    order of the physical line's own appearance in the file. A line's
 *    exact text can repeat elsewhere in the file (duplicated code), each
 *    copy producing an identical mutant at the same column ordinal. This
 *    ordinal is the id's known remaining weak point: reordering those
 *    duplicate lines, or adding another copy earlier in the file, shifts
 *    it — and so the id — for every copy after the change.
 *
 * `records` must already be sorted by source position (line, then
 * column); that order, not the report's array order or a survivors-only
 * order, is what keeps both ordinals stable when a status changes
 * elsewhere in the same file.
 */
export function assignIds(file, records) {
  const byPhysicalLine = new Map();
  for (const r of records) {
    const lineKey = `${r._line}:${r._endLine}`;
    if (!byPhysicalLine.has(lineKey)) byPhysicalLine.set(lineKey, []);
    byPhysicalLine.get(lineKey).push(r);
  }
  for (const members of byPhysicalLine.values()) {
    const withinLine = new Map();
    for (const r of members) {
      const key = `${r.token}\0${r.operator}\0${r.replacement}`;
      if (!withinLine.has(key)) withinLine.set(key, []);
      withinLine.get(key).push(r);
    }
    for (const group of withinLine.values()) {
      group.sort((a, b) => a._column - b._column);
      group.forEach((r, i) => {
        r._columnOrdinal = i;
      });
    }
  }

  const byLineTextGroup = new Map();
  for (const r of records) {
    const key = `${baseIdInput(file, r.lineText, r.token, r.operator, r.replacement)}\0${r._columnOrdinal}`;
    if (!byLineTextGroup.has(key)) byLineTextGroup.set(key, []);
    byLineTextGroup.get(key).push(r);
  }
  for (const group of byLineTextGroup.values()) {
    if (group.length > 1) {
      group.forEach((r, i) => {
        r._occurrenceOrdinal = i;
      });
    }
  }

  for (const r of records) {
    let hashInput = `${baseIdInput(file, r.lineText, r.token, r.operator, r.replacement)}\0${r._columnOrdinal}`;
    if (r._occurrenceOrdinal !== undefined) {
      hashInput = `${hashInput}\0${r._occurrenceOrdinal}`;
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
  // Every mutant, of every status, with just enough to re-derive `summary`
  // after `--since` narrows the digest to a set of changed-line ranges.
  // Internal: stripped from the digest before it is printed (see `run`).
  const mutantIndex = [];

  for (const [file, fileReport] of Object.entries(report.files ?? {})) {
    const lines = fileReport.source.split('\n');
    const fileSourceHash = sourceHash(fileReport.source);

    const records = (fileReport.mutants ?? [])
      .map((mutant) => ({
        mutant,
        file,
        _line: mutant.location.start.line,
        _endLine: mutant.location.end.line,
        _column: mutant.location.start.column,
        subject: findSubject(lines, mutant.location.start.line),
        token: extractToken(lines, mutant.location),
        lineText: lineText(lines, mutant.location),
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

      let entryUnverified = false;
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
        entryUnverified = isUnverified;
        if (isUnverified) unverifiedCount += 1;
        const entry = {
          subject: r.subject,
          file,
          line: r._line,
          location: mutant.location,
          operator: r.operator,
          id: r.id,
          token: r.token,
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
          location: mutant.location,
          id: r.id,
          operator: r.operator,
          token: r.token,
          replacement: r.replacement,
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
          static: mutant.static ?? false,
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

      mutantIndex.push({
        file,
        status: mutant.status,
        start: r._line,
        end: r._endLine,
        unverified: entryUnverified,
      });
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
    schema_version: '5.0',
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
    // Internal: every mutant's file and line range, for `--since` to
    // recompute `summary` after scoping. `run()` deletes this before the
    // digest is printed; it is not part of the schema.
    _mutantIndex: mutantIndex,
  };
}

// mutineer's `survivors[]` keys were the model for `subject`, `file`,
// `line`, `operator`, and `id`; a baseline match stays on `id` alone, not
// on `token`: `token` was dropped from `survivors[]` once, then restored
// for `--format github`'s "<original> -> <replacement>" message, but the
// id it now feeds is already stable across a re-indented or re-ordered
// file, so a baseline match does not need it too.
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

/** Escapes a value for a GitHub Actions workflow command, per its own rule: `%`, then `\r`, then `\n`. */
function escapeGithubValue(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function githubCommand(level, entry, title, message) {
  const file = escapeGithubValue(entry.file);
  const endLine = entry.location.end.line;
  return (
    `::${level} file=${file},line=${entry.line},endLine=${endLine},` +
    `title=${escapeGithubValue(title)}::${escapeGithubValue(message)}`
  );
}

/**
 * Renders the digest as GitHub Actions workflow commands, one per line, so
 * a PR's check annotates the exact line a mutant survived on.
 * `survivors[]` and `no_coverage[]` become `::error`; `unverified[]`
 * becomes `::warning`, since it names a measurement gap, not a proven
 * hole. `timeouts[]` is left out: Stryker already counts a timeout as
 * detected, so `--gate` does not fail on it either (see `run`).
 */
export function formatGithub(digest) {
  const lines = [];
  for (const s of digest.survivors) {
    lines.push(githubCommand('error', s, `${s.operator} survived`, `${s.token} -> ${s.replacement}`));
  }
  for (const c of digest.no_coverage) {
    lines.push(githubCommand('error', c, `${c.operator} survived`, `${c.token} -> ${c.replacement}`));
  }
  for (const u of digest.unverified) {
    lines.push(githubCommand('warning', u, 'unverified', 'no test ran for this mutant'));
  }
  return lines.join('\n');
}

// The order this list emits a `kind`, matching `references/digest.md`'s
// "The output (`--format jsonl`)": survivor, unverified, timeout,
// noCoverage, ignored, invalid, testWithoutKills. This is not the same
// order as `formatGithub`'s or the JSON object's own key order (there,
// `no_coverage` comes right after `unverified`, and `ignored` comes after
// `invalid`); it was fixed once, here, so a reader scanning a live run
// with `tail -f` sees a stable rhythm of kinds.
const JSONL_KINDS = [
  ['survivor', 'survivors'],
  ['unverified', 'unverified'],
  ['timeout', 'timeouts'],
  ['no_coverage', 'no_coverage'],
  ['ignored', 'ignored'],
  ['invalid', 'invalid'],
  ['test_without_kills', 'tests_without_kills'],
];

/**
 * Renders the digest as JSONL, the default format: one JSON value per
 * line, so an agent can `grep`, `jq`, or `tail -n 1` a run's output
 * without parsing the whole file (see "Read it as it runs" in
 * digest.md). The first line is `{"kind":"run",...}`; the last is
 * `{"kind":"summary",...}`; every line in between carries one item, kind
 * by kind, in `JSONL_KINDS`'s order (already the file's own sort order
 * from `buildDigest`, so no re-sort happens here). `per_source[]` has no
 * `kind` of its own and is left out: it is a file-level rollup, already
 * available in full from `--format json`.
 *
 * A survivor's or an item's own fields are unchanged from `--format
 * json`; only `kind` is added, so a reader that already knows those keys
 * needs no new vocabulary. Every key is snake_case, the run line's too.
 *
 * The lists a caller acts on stay lines, not counts: each `stale[]` file
 * is a `{"kind":"stale"}` line (a gate that cannot trust a file must say
 * which one), and with `--baseline` each survivor line carries `new`, and
 * each fixed survivor is a `{"kind":"fixed_survivor"}` line. The summary
 * line adds the counts.
 */
export function formatJsonl(digest) {
  const lines = [];
  lines.push(
    JSON.stringify({
      kind: 'run',
      schema_version: digest.schema_version,
      tool: digest.source.tool,
      report_schema_version: digest.source.report_schema_version,
      disable_bail: digest.source.disable_bail,
    }),
  );
  for (const entry of digest.stale ?? []) {
    lines.push(JSON.stringify({ kind: 'stale', ...entry }));
  }
  const newIds =
    digest.baseline === undefined
      ? undefined
      : new Set(digest.baseline.new_survivors.map((s) => s.id));
  for (const [kind, key] of JSONL_KINDS) {
    for (const entry of digest[key]) {
      const line = { kind, ...entry };
      if (newIds !== undefined && key === 'survivors') {
        line.new = newIds.has(entry.id);
      }
      lines.push(JSON.stringify(line));
    }
  }
  for (const entry of digest.baseline?.fixed_survivors ?? []) {
    lines.push(JSON.stringify({ kind: 'fixed_survivor', ...entry }));
  }
  const summaryLine = { kind: 'summary', ...digest.summary };
  if (digest.scoped !== undefined) {
    summaryLine.scoped = digest.scoped;
    summaryLine.stale_count = digest.stale.length;
  }
  if (digest.baseline !== undefined) {
    summaryLine.new_survivors = digest.baseline.new_survivors.length;
    summaryLine.fixed_survivors = digest.baseline.fixed_survivors.length;
  }
  lines.push(JSON.stringify(summaryLine));
  return lines.join('\n');
}

/**
 * Parses a `git diff --unified=0` hunk header's "+" side into the
 * 1-based, inclusive line ranges it added or changed in the current file.
 * A pure deletion (a "+0" count) contributes no range: there is no line
 * left in the current file to flag.
 */
export function parseUnifiedDiffRanges(diffText) {
  const ranges = [];
  const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = hunkHeader.exec(diffText)) !== null) {
    const start = Number(m[1]);
    const count = m[2] !== undefined ? Number(m[2]) : 1;
    if (count === 0) continue;
    ranges.push({ start, end: start + count - 1 });
  }
  return ranges;
}

function rangesOverlap(start, end, ranges) {
  return ranges.some((r) => start <= r.end && end >= r.start);
}

/**
 * Narrows a digest to the mutants whose line range overlaps a
 * `--since`-derived set of changed-line ranges, one array per file, and
 * recomputes `summary` from the narrowed set (`_mutantIndex`, stripped
 * before the digest is printed). A file the caller has marked stale (its
 * current content no longer matches `source_hash`, or `git diff` itself
 * failed for it) is dropped from every list instead of filtered: in
 * either case, the file's changed-line ranges cannot be trusted, so
 * filtering on them would filter on the wrong lines.
 *
 * `staleFiles` is a `Map<file, reason>`, not a `Set`: two different
 * causes reach here (a content mismatch, and a `git diff` failure), and
 * each needs its own reason string in `stale[]` and in `run`'s stderr
 * warning.
 */
export function applySince(digest, changedRangesByFile, staleFiles) {
  const rangesFor = (file) => changedRangesByFile.get(file) ?? [];

  const filterRanged = (entries) =>
    entries.filter((e) => {
      if (staleFiles.has(e.file)) return false;
      const start = e.location ? e.location.start.line : e.line;
      const end = e.location ? e.location.end.line : e.line;
      return rangesOverlap(start, end, rangesFor(e.file));
    });

  const scopedIndex = (digest._mutantIndex ?? []).filter(
    (m) => !staleFiles.has(m.file) && rangesOverlap(m.start, m.end, rangesFor(m.file)),
  );

  return {
    ...digest,
    scoped: true,
    summary: summarizeMutantIndex(scopedIndex),
    survivors: filterRanged(digest.survivors),
    unverified: filterRanged(digest.unverified),
    no_coverage: filterRanged(digest.no_coverage),
    timeouts: filterRanged(digest.timeouts),
    stale: [...staleFiles.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([file, reason]) => ({ file, reason })),
  };
}

/** Rebuilds a `summary` object from a subset of `_mutantIndex`, the same formulas `buildDigest` uses. */
function summarizeMutantIndex(mutantIndex) {
  const counts = {
    killed: 0,
    timeout: 0,
    survived: 0,
    no_coverage: 0,
    compile_error: 0,
    runtime_error: 0,
    ignored: 0,
    pending: 0,
  };
  let unverifiedCount = 0;
  for (const m of mutantIndex) {
    const key = STATUS_TO_SUMMARY_KEY[m.status];
    if (key) counts[key] += 1;
    if (m.unverified) unverifiedCount += 1;
  }
  const total = mutantIndex.length;
  const detected = counts.killed + counts.timeout;
  const validTotal = detected + counts.survived + counts.no_coverage;
  const coveredTotal = detected + counts.survived;
  const validExcludingUnverified = validTotal - unverifiedCount;
  return {
    total,
    ...counts,
    unverified: unverifiedCount,
    score: validTotal ? round2((detected / validTotal) * 100) : null,
    score_covered: coveredTotal ? round2((detected / coveredTotal) * 100) : null,
    score_excluding_unverified: validExcludingUnverified
      ? round2((detected / validExcludingUnverified) * 100)
      : null,
  };
}

function gitAvailable(cwd) {
  try {
    execFileSync('git', ['--version'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitRefExists(ref, cwd) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** True when git's index tracks `file` (a committed or a staged file, not an untracked one). */
function gitFileTracked(file, cwd) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reduces a failed git command's stderr to one line, for `stale[]`'s
 * `reason` and `run`'s stderr warning: git's own message can run to
 * several lines (an advice block after the "fatal:" line), and only the
 * first says what happened.
 */
function firstStderrLine(err) {
  const text = (err.stderr ?? '').toString().trim();
  return text.split('\n')[0] || err.message;
}

/**
 * Builds `--since`'s two inputs for `applySince`: the changed-line ranges
 * `git diff --unified=0 <ref> -- <file>` reports for every file in the
 * report, and the set of files whose current on-disk content no longer
 * matches the report's own `source_hash` (so `applySince` must drop them,
 * not filter them on a stale line number). This runs over every file in
 * `report.files`, not just a file with a survivor: `summary` (recomputed
 * from `_mutantIndex`, which also covers every file) must count a killed
 * mutant on a changed line too, or a file with no remaining survivor
 * would silently drop its killed count from the scoped score. Only
 * `readFileSync` and `execFileSync('git', ...)` touch the filesystem or a
 * subprocess; both are confined to this function so `applySince` itself
 * stays pure and testable without a real git repository.
 *
 * A file git does not track at all (never added, e.g. new in this
 * branch) has no history for `git diff <ref> -- <file>` to compare
 * against, so that command reports it unchanged, an empty range — which
 * would let every mutant on it pass a `--gate` run silently, the one kind
 * of change a changed-line gate exists to catch. Such a file is instead
 * treated as changed on every one of its own lines: `gitFileTracked`
 * checks the index first, ahead of the `diff` call, and an untracked
 * file's range becomes `[1, <its own line count>]`.
 */
function scopeSince(digest, report, ref, cwd) {
  const files = Object.keys(report.files ?? {});

  const changedRangesByFile = new Map();
  const staleFiles = new Map();

  for (const file of files) {
    const reportSource = report.files?.[file]?.source;
    const reportedHash = reportSource !== undefined ? sourceHash(reportSource) : undefined;
    let currentContent;
    try {
      currentContent = readFileSync(`${cwd}/${file}`, 'utf8');
    } catch (err) {
      staleFiles.set(file, `cannot read ${file}: ${err.message}`);
      continue;
    }
    if (reportedHash === undefined || sourceHash(currentContent) !== reportedHash) {
      staleFiles.set(file, 'source no longer matches the report; cannot scope by line');
      continue;
    }

    if (!gitFileTracked(file, cwd)) {
      const lineCount = currentContent.split('\n').length;
      changedRangesByFile.set(file, [{ start: 1, end: lineCount }]);
      continue;
    }

    let diffText;
    try {
      diffText = execFileSync('git', ['diff', '--unified=0', ref, '--', file], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      staleFiles.set(file, `git diff failed: ${firstStderrLine(err)}`);
      continue;
    }
    changedRangesByFile.set(file, parseUnifiedDiffRanges(diffText));
  }

  return applySince(digest, changedRangesByFile, staleFiles);
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
 * Returns a `schema_version` string's leading number, or `-1` when it is
 * missing or unparseable, so a caller comparing it against a minimum with
 * `<` treats an absent version as "too old" rather than as `NaN`, which
 * `<` and `>=` both silently treat as false.
 */
function baselineMajorVersion(schemaVersion) {
  const m = /^(\d+)\./.exec(String(schemaVersion));
  return m ? Number(m[1]) : -1;
}

/**
 * Reads a `--baseline` file as either shape digest.mjs can write: one
 * JSON object (`--format json`), or JSONL (`--format jsonl`, the
 * default), told apart by whether the first line parses as its own JSON
 * value with `kind: "run"`. Both use the same field names for a
 * survivor, so a JSONL baseline reduces to the same `{ schema_version,
 * survivors }` shape `compareBaseline` already expects.
 */
function readBaselineDigest(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${err.message}`);
  }
  const trimmed = raw.replace(/\n$/, '');
  const firstLine = trimmed.split('\n', 1)[0];
  let firstLineParsed;
  try {
    firstLineParsed = JSON.parse(firstLine);
  } catch {
    firstLineParsed = undefined;
  }
  if (!(firstLineParsed && firstLineParsed.kind === 'run')) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new UsageError(`cannot parse ${path} as JSON: ${err.message}`);
    }
  }
  const survivors = [];
  for (const line of trimmed.split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    } catch (err) {
      throw new UsageError(`cannot parse ${path} as JSONL: ${err.message}`);
    }
    if (record.kind === 'survivor') {
      const { kind, ...rest } = record;
      survivors.push(rest);
    }
  }
  return { schema_version: firstLineParsed.schemaVersion, survivors };
}

/**
 * Runs the CLI end to end and returns its output and exit code, without
 * calling `process.exit`. Kept separate from `main()` so tests can call it
 * in-process.
 */
export function run(argv, { cwd = process.cwd() } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        baseline: { type: 'string' },
        format: { type: 'string', default: 'jsonl' },
        output: { type: 'string' },
        since: { type: 'string' },
        gate: { type: 'boolean', default: false },
      },
    });
  } catch (err) {
    return { exitCode: 2, stderr: `usage error: ${err.message}\n`, stdout: '' };
  }

  const reportPath = parsed.positionals[0] ?? DEFAULT_REPORT_PATH;
  const format = parsed.values.format;
  if (format !== 'jsonl' && format !== 'json' && format !== 'text' && format !== 'github') {
    return { exitCode: 2, stderr: `usage error: unknown --format ${format}\n`, stdout: '' };
  }

  let digest;
  let stderr = '';
  try {
    const report = readJsonFile(reportPath);
    digest = buildDigest(report);

    if (parsed.values.since) {
      if (!gitAvailable(cwd)) {
        return { exitCode: 2, stderr: 'usage error: --since needs git, and it is not on PATH\n', stdout: '' };
      }
      if (!gitRefExists(parsed.values.since, cwd)) {
        return {
          exitCode: 2,
          stderr: `usage error: --since ref not found: ${parsed.values.since}\n`,
          stdout: '',
        };
      }
      digest = scopeSince(digest, report, parsed.values.since, cwd);
      if (digest.stale.length > 0) {
        for (const s of digest.stale) {
          stderr += `warning: ${s.file}: ${s.reason}\n`;
        }
      }
    }

    if (parsed.values.baseline) {
      const baselineDigest = readBaselineDigest(parsed.values.baseline);
      // A minor bump, or the 4.0-to-5.0 change of output shape alone (JSON
      // to JSONL, with no change to a survivor's own keys), does not touch
      // `id`'s material (see "Compatibility" in digest.md); only a major
      // version below 4, where `id`'s own material last changed, is
      // rejected.
      if (baselineMajorVersion(baselineDigest.schema_version) < 4) {
        return {
          exitCode: 2,
          stderr:
            `usage error: --baseline schema_version ${String(baselineDigest.schema_version)} ` +
            `is older than 4.0; the id's material changed there, so an id from an older ` +
            `baseline cannot match an id here\n`,
          stdout: '',
        };
      }
      digest.baseline = compareBaseline(digest, baselineDigest);
    }

    delete digest._mutantIndex;
  } catch (err) {
    if (err instanceof UsageError) {
      return { exitCode: 2, stderr: `usage error: ${err.message}\n`, stdout: '' };
    }
    throw err;
  }

  if (parsed.values.gate) {
    const staticTimeouts = digest.timeouts.filter((t) => t.static).length;
    if (staticTimeouts > 0) {
      stderr +=
        `warning: ${staticTimeouts} static mutant timeout(s); a static mutant's timeout is a ` +
        `measurement concern to reread, not a proven gap (see digest.md)\n`;
    }
  }

  const body =
    format === 'text'
      ? formatText(digest)
      : format === 'github'
        ? formatGithub(digest)
        : format === 'jsonl'
          ? formatJsonl(digest)
          : JSON.stringify(digest);
  const output = `${body}\n`;

  if (parsed.values.output) {
    writeFileSync(parsed.values.output, output);
  }

  let exitCode = digest.baseline && digest.baseline.new_survivors.length > 0 ? 1 : 0;
  if (parsed.values.gate) {
    const staleCount = digest.stale ? digest.stale.length : 0;
    if (digest.unverified.length > 0 || staleCount > 0) {
      // A stale file could not be scoped at all, the same measurement gap
      // `unverified[]` names for a mutant: neither says the code has a
      // real hole, only that this run cannot tell.
      exitCode = 3;
    } else if (digest.survivors.length > 0 || digest.no_coverage.length > 0) {
      exitCode = 1;
    } else {
      exitCode = 0;
    }
  }

  return {
    exitCode,
    stdout: parsed.values.output ? '' : output,
    stderr,
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
