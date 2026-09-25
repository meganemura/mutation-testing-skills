// Responsibility: exercises digest.mjs's pure functions directly, and its
// CLI surface (exit codes, flag parsing) through a child process.
// Boundary: does not run Stryker; every report here is a synthetic fixture.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import {
  assignIds,
  buildDiff,
  buildDigest,
  compareBaseline,
  extractToken,
  findSubject,
  formatText,
} from './digest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const digestPath = path.join(here, 'digest.mjs');
const fixturesDir = path.join(here, 'fixtures');
const reportPath = path.join(fixturesDir, 'report.json');
const baselinePath = path.join(fixturesDir, 'baseline-digest.json');

function loadReport() {
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

function runCli(args, options = {}) {
  try {
    const stdout = execFileSync('node', [digestPath, ...args], {
      cwd: here,
      encoding: 'utf8',
      ...options,
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

test('summary counts and score, including a zero denominator', () => {
  const digest = buildDigest(loadReport());
  assert.equal(digest.summary.total, 10);
  assert.equal(digest.summary.killed, 2);
  assert.equal(digest.summary.timeout, 1);
  assert.equal(digest.summary.survived, 3);
  assert.equal(digest.summary.no_coverage, 1);
  assert.equal(digest.summary.compile_error, 1);
  assert.equal(digest.summary.runtime_error, 1);
  assert.equal(digest.summary.ignored, 1);
  assert.equal(digest.summary.score, 42.86);
  assert.equal(digest.summary.score_covered, 50);

  const emptyReport = {
    schemaVersion: '1.0',
    projectRoot: '/repo',
    files: {},
    testFiles: {},
  };
  const emptyDigest = buildDigest(emptyReport);
  assert.equal(emptyDigest.summary.score, null);
  assert.equal(emptyDigest.summary.score_covered, null);
});

test('survivor token, diff, subject, tests, and rerun', () => {
  const digest = buildDigest(loadReport());
  const survivor = digest.survivors.find((s) => s.token === 'total - 1');
  assert.equal(survivor.subject, 'add');
  assert.equal(survivor.file, 'src/a.ts');
  assert.equal(survivor.line, 5);
  assert.equal(survivor.diff, '@@ -5 +5 @@\n-    total = total - 1;\n+    total = total + 1;');
  assert.deepEqual(survivor.tests, [{ name: 'add works', file: 'test/a.test.ts' }]);
  assert.equal(survivor.rerun, 'npx stryker run --force --mutate "src/a.ts:5:12-5:21"');

  const method = digest.survivors.find((s) => s.subject === 'Box#inc');
  assert.ok(method, 'expected a survivor inside Box#inc');
});

test('rerun range: end column is one less than the report location, per Stryker\'s CLI parsing', () => {
  const digest = buildDigest(loadReport());
  const blockSurvivor = digest.survivors.find((s) => s.operator === 'BlockStatement');
  // location: start {line:4,column:19}, end {line:6,column:4} (1-based, end exclusive)
  assert.equal(blockSurvivor.rerun, 'npx stryker run --force --mutate "src/a.ts:4:18-6:3"');
});

test('id is stable when a line is added earlier in the file', () => {
  const report = loadReport();
  const shifted = structuredClone(report);
  for (const file of Object.values(shifted.files)) {
    file.source = `// added line\n${file.source}`;
    for (const mutant of file.mutants) {
      mutant.location.start.line += 1;
      mutant.location.end.line += 1;
    }
  }

  const before = buildDigest(report);
  const after = buildDigest(shifted);

  const beforeIds = before.survivors.map((s) => `${s.file}:${s.token}:${s.operator}`).sort();
  const afterIds = after.survivors.map((s) => `${s.file}:${s.token}:${s.operator}`).sort();
  assert.deepEqual(beforeIds, afterIds);

  const beforeById = new Map(before.survivors.map((s) => [`${s.file}|${s.token}|${s.operator}`, s.id]));
  for (const s of after.survivors) {
    const key = `${s.file}|${s.token}|${s.operator}`;
    assert.equal(s.id, beforeById.get(key), `id changed for ${key}`);
  }
});

test('the same token appearing twice gets two different ids', () => {
  const digest = buildDigest(loadReport());
  const boxSurvivor = digest.survivors.find((s) => s.token === 'this.value + step');
  const killed = loadReport().files['src/a.ts'].mutants.find(
    (m) => m.status === 'Killed' && m.mutatorName === 'ArithmeticOperator',
  );
  assert.notEqual(boxSurvivor.id, undefined);
  // The killed twin shares (file, subject, token, operator, replacement)
  // with the survivor above; assignIds must give it a different id.
  const records = [
    { file: 'src/a.ts', subject: 'Box#inc', token: 'this.value + step', operator: 'ArithmeticOperator', replacement: 'this.value - step' },
    { file: 'src/a.ts', subject: 'Box#inc', token: 'this.value + step', operator: 'ArithmeticOperator', replacement: 'this.value - step' },
  ];
  assignIds('src/a.ts', records);
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(records.filter((r) => r.id === boxSurvivor.id).length, 1);
});

test('a duplicate\'s id does not change when its twin\'s status changes', () => {
  const report = loadReport();
  const before = buildDigest(report);
  const beforeSurvivorId = before.survivors.find((s) => s.token === 'this.value + step').id;

  // Flip the killed twin (line 14) to Survived too; the original survivor
  // (line 13) keeps its position and so must keep its id.
  const flipped = structuredClone(report);
  const twin = flipped.files['src/a.ts'].mutants.find((m) => m.id === 'a4');
  twin.status = 'Survived';
  delete twin.killedBy;

  const after = buildDigest(flipped);
  const afterSurvivor = after.survivors.find(
    (s) => s.token === 'this.value + step' && s.line === 13,
  );
  assert.equal(afterSurvivor.id, beforeSurvivorId);
});

test('output is deterministic across two runs', () => {
  const a = JSON.stringify(buildDigest(loadReport()));
  const b = JSON.stringify(buildDigest(loadReport()));
  assert.equal(a, b);
});

test('--baseline reports new and fixed survivors, and exits 1 on new survivors', () => {
  const digest = buildDigest(loadReport());
  const baselineDigest = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const result = compareBaseline(digest, baselineDigest);
  assert.equal(result.new_survivors.length, 2);
  assert.equal(result.fixed_survivors.length, 1);
  assert.equal(result.fixed_survivors[0].id, 'aaaaaaaaaaaa');

  const cli = runCli(['fixtures/report.json', '--baseline', 'fixtures/baseline-digest.json']);
  assert.equal(cli.exitCode, 1);
  const parsed = JSON.parse(cli.stdout);
  assert.equal(parsed.baseline.new_survivors.length, 2);
  assert.equal(parsed.baseline.fixed_survivors.length, 1);
});

test('a report with no new survivors exits 0', () => {
  const digest = buildDigest(loadReport());
  const sameBaseline = { survivors: digest.survivors };
  const result = compareBaseline(digest, sameBaseline);
  assert.equal(result.new_survivors.length, 0);
});

test('an unreadable report file exits 2', () => {
  const cli = runCli(['fixtures/does-not-exist.json']);
  assert.equal(cli.exitCode, 2);
  assert.match(cli.stderr, /usage error/);
});

test('an unknown flag exits 2', () => {
  const cli = runCli(['fixtures/report.json', '--not-a-real-flag']);
  assert.equal(cli.exitCode, 2);
  assert.match(cli.stderr, /usage error/);
});

test('a report_schema_version outside 1.x exits 2', () => {
  const cli = runCli(['fixtures/bad-schema-version.json']);
  assert.equal(cli.exitCode, 2);
  assert.match(cli.stderr, /usage error/);
});

test('statusReason sandbox paths and queries are removed', () => {
  const digest = buildDigest(loadReport());
  const timeout = digest.timeouts[0];
  assert.doesNotMatch(timeout.status_reason, /\/repo\//);
  assert.doesNotMatch(timeout.status_reason, /sandbox-/);
  assert.doesNotMatch(timeout.status_reason, /\?vitest=/);

  const invalidRuntimeError = digest.invalid.find((i) => i.status === 'RuntimeError');
  assert.doesNotMatch(invalidRuntimeError.status_reason, /\/repo\//);
  assert.doesNotMatch(invalidRuntimeError.status_reason, /sandbox-/);

  const ignoredEntry = digest.ignored[0];
  assert.doesNotMatch(ignoredEntry.reason, /\/repo\//);
  assert.doesNotMatch(ignoredEntry.reason, /sandbox-/);
});

test('subject detection excludes control-flow keywords and matches the enclosing method', () => {
  const lines = [
    'export function outer() {',
    '  if (x > 0) {',
    '    for (let i = 0; i < 1; i++) {',
    '      target();',
    '    }',
    '  }',
    '}',
  ];
  assert.equal(findSubject(lines, 4), 'outer');
});

test('subject detection does not treat Array.from\'s callback as an arrow declaration', () => {
  const lines = [
    'export function hex(bytes) {',
    '  const out = Array.from(bytes, (b) => b.toString(16));',
    '  return out;',
    '}',
  ];
  assert.equal(findSubject(lines, 2), 'hex');
});

test('subject detection prefixes a class method with its class name', () => {
  const lines = ['class Box {', '  inc(step) {', '    target();', '  }', '}'];
  assert.equal(findSubject(lines, 3), 'Box#inc');
});

test('extractToken collapses whitespace and spans multiple lines', () => {
  const lines = ['const x = {', '  a: 1,', '};'];
  const token = extractToken(lines, {
    start: { line: 1, column: 11 },
    end: { line: 3, column: 2 },
  });
  assert.equal(token, '{ a: 1, }');
});

test('buildDiff emits a multi-line hunk header when the range spans lines', () => {
  const lines = ['if (x) {', '  y();', '}'];
  const diff = buildDiff(
    lines,
    { start: { line: 1, column: 8 }, end: { line: 3, column: 2 } },
    '{}',
  );
  assert.equal(diff, '@@ -1,3 +1,1 @@\n-if (x) {\n-  y();\n-}\n+if (x) {}');
});

test('formatText prints one block per survivor and a summary line', () => {
  const digest = buildDigest(loadReport());
  const text = formatText(digest);
  assert.equal(text.split('\n').filter((l) => l.startsWith('npx stryker run')).length, 3);
  assert.match(text, /^summary: total=10 /m);
});
