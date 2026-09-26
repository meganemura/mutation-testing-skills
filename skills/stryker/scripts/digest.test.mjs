// Responsibility: exercises digest.mjs's pure functions directly, and its
// CLI surface (exit codes, flag parsing) through a child process.
// Boundary: does not run Stryker; every report here is a synthetic fixture.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import {
  assignIds,
  buildDiff,
  buildDigest,
  buildPatch,
  compareBaseline,
  extractToken,
  findSubject,
  formatText,
  sourceHash,
  summarizeTests,
} from './digest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const digestPath = path.join(here, 'digest.mjs');
const fixturesDir = path.join(here, 'fixtures');
const reportPath = path.join(fixturesDir, 'report.json');
const baselinePath = path.join(fixturesDir, 'baseline-digest.json');

function loadReport() {
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

const gitAvailable = spawnSync('git', ['--version']).status === 0;

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

test('survivor patch, subject, tests, source_hash, rerun, and rerun_exact', () => {
  const digest = buildDigest(loadReport());
  const survivor = digest.survivors.find((s) => s.replacement === 'total + 1');
  assert.equal(survivor.subject, 'add');
  assert.equal(survivor.file, 'src/a.ts');
  assert.equal(survivor.line, 5);
  assert.equal(
    survivor.patch,
    '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -5,1 +5,1 @@\n' +
      '-    total = total - 1;\n+    total = total + 1;\n',
  );
  assert.deepEqual(survivor.tests, {
    total: 1,
    truncated: false,
    files: [{ file: 'test/a.test.ts', count: 1, names: ['add works'] }],
  });
  assert.equal(survivor.rerun, 'npx stryker run --incremental --mutate "src/a.ts"');
  assert.equal(survivor.rerun_exact, 'npx stryker run --force --mutate "src/a.ts:5:12-5:21"');
  assert.ok(!('token' in survivor), 'survivors[] no longer carries token');
  assert.ok(!('diff' in survivor), 'survivors[] no longer carries diff');

  const expectedHash = createHash('sha256')
    .update(loadReport().files['src/a.ts'].source)
    .digest('hex')
    .slice(0, 16);
  assert.equal(survivor.source_hash, expectedHash);
  assert.equal(sourceHash(loadReport().files['src/a.ts'].source), expectedHash);

  const method = digest.survivors.find((s) => s.subject === 'Box#inc');
  assert.ok(method, 'expected a survivor inside Box#inc');
});

test('rerun_exact range: end column is one less than the report location, per Stryker\'s CLI parsing', () => {
  const digest = buildDigest(loadReport());
  const blockSurvivor = digest.survivors.find((s) => s.operator === 'BlockStatement');
  // location: start {line:4,column:19}, end {line:6,column:4} (1-based, end exclusive)
  assert.equal(
    blockSurvivor.rerun_exact,
    'npx stryker run --force --mutate "src/a.ts:4:18-6:3"',
  );
});

test('patch applies with git apply --unidiff-zero', { skip: !gitAvailable && 'git is not installed' }, () => {
  const digest = buildDigest(loadReport());
  const dir = mkdtempSync(path.join(tmpdir(), 'digest-patch-'));
  try {
    for (const [file, fileReport] of Object.entries(loadReport().files)) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, fileReport.source);
    }
    for (const survivor of digest.survivors) {
      const patchFile = path.join(dir, 'mutant.patch');
      writeFileSync(patchFile, survivor.patch);
      const result = spawnSync(
        'git',
        ['-C', dir, 'apply', '--unidiff-zero', '--check', 'mutant.patch'],
        { encoding: 'utf8' },
      );
      assert.equal(
        result.status,
        0,
        `git apply --check failed for ${survivor.file}:${survivor.line}: ${result.stderr}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPatch wraps buildDiff with a/ and b/ file headers and a trailing newline', () => {
  const lines = ['if (x) {', '  y();', '}'];
  const patch = buildPatch(
    'src/f.ts',
    lines,
    { start: { line: 1, column: 8 }, end: { line: 3, column: 2 } },
    '{}',
  );
  assert.equal(
    patch,
    '--- a/src/f.ts\n+++ b/src/f.ts\n@@ -1,3 +1,1 @@\n-if (x) {\n-  y();\n-}\n+if (x) {}\n',
  );
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

  // `replacement` stands in for `token` here: both come from the same
  // report positions, and a survivor no longer carries `token`.
  const beforeIds = before.survivors.map((s) => `${s.file}:${s.replacement}:${s.operator}`).sort();
  const afterIds = after.survivors.map((s) => `${s.file}:${s.replacement}:${s.operator}`).sort();
  assert.deepEqual(beforeIds, afterIds);

  const beforeById = new Map(
    before.survivors.map((s) => [`${s.file}|${s.replacement}|${s.operator}`, s.id]),
  );
  for (const s of after.survivors) {
    const key = `${s.file}|${s.replacement}|${s.operator}`;
    assert.equal(s.id, beforeById.get(key), `id changed for ${key}`);
  }
});

test('the same token appearing twice gets two different ids', () => {
  const digest = buildDigest(loadReport());
  const boxSurvivor = digest.survivors.find((s) => s.replacement === 'this.value - step');
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
  const beforeSurvivorId = before.survivors.find((s) => s.replacement === 'this.value - step').id;

  // Flip the killed twin (line 14) to Survived too; the original survivor
  // (line 13) keeps its position and so must keep its id.
  const flipped = structuredClone(report);
  const twin = flipped.files['src/a.ts'].mutants.find((m) => m.id === 'a4');
  twin.status = 'Survived';
  delete twin.killedBy;

  const after = buildDigest(flipped);
  const afterSurvivor = after.survivors.find(
    (s) => s.replacement === 'this.value - step' && s.line === 13,
  );
  assert.equal(afterSurvivor.id, beforeSurvivorId);
});

test('summarizeTests: exactly 10 files is not truncated, 11 files is', () => {
  const tenFiles = Array.from({ length: 10 }, (_, i) => ({
    name: 't', file: `test/f${String(i).padStart(2, '0')}.test.ts`,
  }));
  const ten = summarizeTests(tenFiles);
  assert.equal(ten.files.length, 10);
  assert.equal(ten.truncated, false);
  assert.equal(ten.total, 10);

  const elevenFiles = [...tenFiles, { name: 't', file: 'test/f10.test.ts' }];
  const eleven = summarizeTests(elevenFiles);
  assert.equal(eleven.files.length, 10);
  assert.equal(eleven.truncated, true);
  assert.equal(eleven.total, 11);
});

test('summarizeTests: exactly 3 names is not truncated, 4 names is', () => {
  const threeNames = ['c', 'a', 'b'].map((name) => ({ name, file: 'test/f.test.ts' }));
  const three = summarizeTests(threeNames);
  assert.equal(three.truncated, false);
  assert.deepEqual(three.files[0].names, ['a', 'b', 'c']);
  assert.equal(three.files[0].count, 3);

  const fourNames = [...threeNames, { name: 'd', file: 'test/f.test.ts' }];
  const four = summarizeTests(fourNames);
  assert.equal(four.truncated, true);
  assert.deepEqual(four.files[0].names, ['a', 'b', 'c']);
  assert.equal(four.files[0].count, 4);
});

test('summarizeTests: files sort by count descending, ties by file name', () => {
  const tests = [
    { name: 't1', file: 'test/b.test.ts' },
    { name: 't1', file: 'test/a.test.ts' },
    { name: 't2', file: 'test/a.test.ts' },
    { name: 't1', file: 'test/c.test.ts' },
    { name: 't2', file: 'test/c.test.ts' },
  ];
  const result = summarizeTests(tests);
  assert.deepEqual(
    result.files.map((f) => f.file),
    ['test/a.test.ts', 'test/c.test.ts', 'test/b.test.ts'],
  );
  assert.equal(result.total, 5);
  assert.equal(result.truncated, false);
});

test('summarizeTests: an empty tests list is not truncated and has no files', () => {
  const result = summarizeTests([]);
  assert.deepEqual(result, { total: 0, truncated: false, files: [] });
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

test('a v2 digest\'s id matches the same survivor\'s id in a v1 (schema_version 1.0) baseline', () => {
  const digest = buildDigest(loadReport());
  const baselineDigest = JSON.parse(readFileSync(baselinePath, 'utf8'));
  assert.equal(baselineDigest.schema_version, '1.0');
  const v1Entry = baselineDigest.survivors.find((s) => s.token === 'total - 1');
  const v2Survivor = digest.survivors.find((s) => s.replacement === 'total + 1');
  assert.equal(v2Survivor.id, v1Entry.id, 'id must not change between schema versions');
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

test('formatText prints one block per survivor (rerun and rerun_exact) and a summary line', () => {
  const digest = buildDigest(loadReport());
  const text = formatText(digest);
  // 3 survivors x 2 rerun commands (rerun, rerun_exact) each.
  assert.equal(text.split('\n').filter((l) => l.startsWith('npx stryker run')).length, 6);
  assert.match(text, /^summary: total=10 .*unverified=0 .*score_excluding_unverified=42\.86$/m);
  assert.doesNotMatch(text, /ran no test/);
});

test('unverified[]: a Survived, covered mutant with no completed test run does not enter survivors[]', () => {
  const report = {
    schemaVersion: '1.0',
    projectRoot: '/repo',
    files: {
      'src/u.ts': {
        source: 'export function u(x) {\n  return x + 1;\n}\n',
        mutants: [
          {
            id: 'u1',
            mutatorName: 'ArithmeticOperator',
            replacement: 'x - 1',
            status: 'Survived',
            coveredBy: ['t1'],
            testsCompleted: 0,
            location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
          },
          {
            id: 'u2',
            mutatorName: 'ArithmeticOperator',
            replacement: 'x * 1',
            status: 'Survived',
            coveredBy: ['t1'],
            testsCompleted: 2,
            location: { start: { line: 2, column: 10 }, end: { line: 2, column: 11 } },
          },
          {
            id: 'u3',
            mutatorName: 'ArithmeticOperator',
            replacement: 'x % 1',
            status: 'Survived',
            coveredBy: [],
            testsCompleted: 0,
            location: { start: { line: 2, column: 10 }, end: { line: 2, column: 12 } },
          },
        ],
      },
    },
    testFiles: {
      'test/u.test.ts': { tests: [{ id: 't1', name: 'u works' }] },
    },
  };

  const digest = buildDigest(report);

  assert.equal(digest.unverified.length, 1);
  assert.equal(digest.unverified[0].replacement, 'x - 1');
  assert.ok(digest.unverified[0].patch, 'unverified entries carry a patch, same shape as survivors[]');
  assert.ok(digest.unverified[0].rerun);
  assert.ok(digest.unverified[0].rerun_exact);
  assert.ok(digest.unverified[0].source_hash);

  // u2 (a real, completed run) and u3 (Survived but with an empty
  // coveredBy, so the guard does not fire) both stay in survivors[].
  const survivorReplacements = digest.survivors.map((s) => s.replacement).sort();
  assert.deepEqual(survivorReplacements, ['x % 1', 'x * 1']);

  // Stryker counts an unverified mutant as survived, so `summary.survived`
  // and `summary.score` are unchanged by the split; only the routing
  // between survivors[] and unverified[] changes.
  assert.equal(digest.summary.survived, 3);
  assert.equal(digest.summary.unverified, 1);
  assert.equal(digest.summary.score, 0);
  assert.equal(digest.summary.score_excluding_unverified, 0);

  const text = formatText(digest);
  assert.match(text, /^1 survivors ran no test; fix the measurement first\. See unverified\[\]\.$/m);

  // unverified[] never counts toward --baseline's new_survivors.
  const unverifiedId = digest.unverified[0].id;
  const baseline = compareBaseline(digest, { survivors: [] });
  assert.equal(baseline.new_survivors.length, 2);
  assert.ok(!baseline.new_survivors.some((s) => s.id === unverifiedId));
});
