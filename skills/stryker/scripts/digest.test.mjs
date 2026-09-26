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
  formatGithub,
  formatJsonl,
  formatText,
  parseUnifiedDiffRanges,
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
  assert.equal(survivor.token, 'total - 1', '--format github reads the original code from token');
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

test('id is stable when the mutated line is re-indented', () => {
  const report = loadReport();
  const indented = structuredClone(report);
  const file = indented.files['src/a.ts'];
  const lines = file.source.split('\n');
  // Line 5 (1-based) is `    total = total - 1;`; add 4 more leading
  // spaces and shift that line's mutant columns by the same amount, so
  // the mutated token itself is unchanged.
  lines[4] = `    ${lines[4]}`;
  file.source = lines.join('\n');
  for (const mutant of file.mutants) {
    if (mutant.location.start.line === 5) {
      mutant.location.start.column += 4;
      mutant.location.end.column += 4;
    }
  }

  const before = buildDigest(report);
  const after = buildDigest(indented);
  const beforeId = before.survivors.find((s) => s.replacement === 'total + 1').id;
  const afterId = after.survivors.find((s) => s.replacement === 'total + 1').id;
  assert.equal(afterId, beforeId);
});

test('two mutants on the same line with the same token, operator, and replacement get different ids', () => {
  // "total = total + step + step;" — flipping either `+` to `-` produces
  // the same (line text, token, operator, replacement); only the column
  // ordinal (the id's 6th material) tells them apart.
  const records = [
    { file: 'f.ts', _line: 1, _endLine: 1, _column: 20, lineText: 'total = total + step + step;', token: 'total + step', operator: 'ArithmeticOperator', replacement: 'total - step' },
    { file: 'f.ts', _line: 1, _endLine: 1, _column: 8, lineText: 'total = total + step + step;', token: 'total + step', operator: 'ArithmeticOperator', replacement: 'total - step' },
  ];
  assignIds('f.ts', records);
  assert.notEqual(records[0].id, records[1].id);
  // Sorted by column: the one at column 8 is the file's first occurrence.
  const first = records.find((r) => r._column === 8);
  const second = records.find((r) => r._column === 20);
  assert.equal(first._columnOrdinal, 0);
  assert.equal(second._columnOrdinal, 1);
});

test('a duplicate\'s id does not change when its twin\'s status changes', () => {
  // Fixture lines 13 and 14 are identical text ("this.value = this.value
  // + step;"), so mutant a3 (Survived) and a4 (Killed) share (file, line
  // text, token, operator, replacement) and differ only by the item-7
  // occurrence ordinal below.
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
  const afterTwin = after.survivors.find(
    (s) => s.replacement === 'this.value - step' && s.line === 14,
  );
  assert.notEqual(afterTwin.id, afterSurvivor.id, 'the repeated line is told apart by occurrence order');
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

  const cli = runCli([
    'fixtures/report.json',
    '--baseline',
    'fixtures/baseline-digest.json',
    '--format',
    'json',
  ]);
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

test('--baseline from a schema_version other than 4.0 warns and exits 2, without new or fixed', () => {
  const cli = runCli(['fixtures/report.json', '--baseline', 'fixtures/baseline-digest-old-schema.json']);
  assert.equal(cli.exitCode, 2);
  assert.match(cli.stderr, /usage error/);
  assert.match(cli.stderr, /schema_version/);
  assert.equal(cli.stdout, '', 'a schema mismatch prints no digest');
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

test('parseUnifiedDiffRanges reads the "+" side of each hunk, and a pure deletion contributes no range', () => {
  const diff = [
    '@@ -1,2 +1,3 @@',
    '+added line 1',
    ' kept line',
    '+added line 2',
    '@@ -10,2 +11,0 @@',
    '-removed line 1',
    '-removed line 2',
    '@@ -20 +19 @@',
    '-old',
    '+new',
  ].join('\n');
  assert.deepEqual(parseUnifiedDiffRanges(diff), [
    { start: 1, end: 3 },
    { start: 19, end: 19 },
  ]);
});

test('formatGithub escapes %, \\r, and \\n in a value, and marks unverified as a warning', () => {
  const digest = {
    survivors: [
      {
        file: 'src/a.ts',
        line: 5,
        location: { start: { line: 5, column: 1 }, end: { line: 5, column: 10 } },
        operator: 'ArithmeticOperator',
        token: 'a % b\r\n',
        replacement: 'a + b',
      },
    ],
    no_coverage: [
      {
        file: 'src/b.ts',
        line: 2,
        location: { start: { line: 2, column: 1 }, end: { line: 2, column: 5 } },
        operator: 'StringLiteral',
        token: 'x',
        replacement: 'y',
      },
    ],
    unverified: [
      {
        file: 'src/c.ts',
        line: 7,
        location: { start: { line: 7, column: 1 }, end: { line: 7, column: 2 } },
        operator: 'BooleanLiteral',
        token: 't',
        replacement: 'f',
      },
    ],
  };
  const out = formatGithub(digest).split('\n');
  assert.deepEqual(out, [
    '::error file=src/a.ts,line=5,endLine=5,title=ArithmeticOperator survived::a %25 b%0D%0A -> a + b',
    '::error file=src/b.ts,line=2,endLine=2,title=StringLiteral survived::x -> y',
    '::warning file=src/c.ts,line=7,endLine=7,title=unverified::no test ran for this mutant',
  ]);
});

test('--format github via the CLI produces one workflow command per flagged mutant', () => {
  const cli = runCli(['fixtures/report.json', '--format', 'github']);
  assert.equal(cli.exitCode, 0);
  const lines = cli.stdout.trim().split('\n');
  // 3 survivors + 1 no_coverage, both rendered as `::error`.
  assert.equal(lines.filter((l) => l.startsWith('::error')).length, 4);
});

test('--gate exits 1 when survivors remain, 3 when a mutant is unverified, 0 when neither', () => {
  const survivorsCli = runCli(['fixtures/report.json', '--gate']);
  assert.equal(survivorsCli.exitCode, 1);

  const dir = mkdtempSync(path.join(tmpdir(), 'digest-gate-'));
  try {
    const unverifiedReport = {
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
          ],
        },
      },
      testFiles: { 'test/u.test.ts': { tests: [{ id: 't1', name: 'u works' }] } },
    };
    const unverifiedPath = path.join(dir, 'unverified.json');
    writeFileSync(unverifiedPath, JSON.stringify(unverifiedReport));
    const unverifiedCli = runCli([unverifiedPath, '--gate']);
    assert.equal(unverifiedCli.exitCode, 3);

    const cleanReport = {
      schemaVersion: '1.0',
      projectRoot: '/repo',
      files: {
        'src/k.ts': {
          source: 'export function k(x) {\n  return x + 1;\n}\n',
          mutants: [
            {
              id: 'k1',
              mutatorName: 'ArithmeticOperator',
              replacement: 'x - 1',
              status: 'Killed',
              coveredBy: ['t1'],
              killedBy: ['t1'],
              testsCompleted: 1,
              location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
            },
          ],
        },
      },
      testFiles: { 'test/k.test.ts': { tests: [{ id: 't1', name: 'k works' }] } },
    };
    const cleanPath = path.join(dir, 'clean.json');
    writeFileSync(cleanPath, JSON.stringify(cleanReport));
    const cleanCli = runCli([cleanPath, '--gate']);
    assert.equal(cleanCli.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--gate warns to stderr about a static mutant timeout, without failing the gate on it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'digest-gate-static-'));
  try {
    const report = {
      schemaVersion: '1.0',
      projectRoot: '/repo',
      files: {
        'src/s.ts': {
          source: 'const LIMIT = 1 + 1;\n',
          mutants: [
            {
              id: 's1',
              mutatorName: 'ArithmeticOperator',
              replacement: '1 - 1',
              status: 'Timeout',
              static: true,
              coveredBy: [],
              location: { start: { line: 1, column: 15 }, end: { line: 1, column: 20 } },
            },
          ],
        },
      },
      testFiles: {},
    };
    const reportPathHere = path.join(dir, 'static-timeout.json');
    writeFileSync(reportPathHere, JSON.stringify(report));
    const result = spawnSync('node', [digestPath, reportPathHere, '--gate'], { encoding: 'utf8' });
    assert.equal(result.status, 0, 'a timeout never fails the gate');
    assert.match(result.stderr, /static mutant timeout/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  '--since scopes survivors, no_coverage, and unverified to a changed-line range',
  { skip: !gitAvailable && 'git is not installed' },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'digest-since-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });

      mkdirSync(path.join(dir, 'src'), { recursive: true });
      const original = 'export function a(x) {\n  return x + 1;\n}\n\nexport function b(x) {\n  return x + 2;\n}\n';
      const originalG = 'export function c(x) {\n  return x + 3;\n}\n';
      writeFileSync(path.join(dir, 'src', 'f.ts'), original);
      writeFileSync(path.join(dir, 'src', 'g.ts'), originalG);
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
      const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      // Only `a`'s line changes; `b`'s line 6 stays out of the diff.
      const changed = 'export function a(x) {\n  return x + 100;\n}\n\nexport function b(x) {\n  return x + 2;\n}\n';
      writeFileSync(path.join(dir, 'src', 'f.ts'), changed);
      // `g.ts` has no survivor at all, only a mutant Stryker killed, on
      // its own changed line: `--since` must still count it in `summary`.
      const changedG = 'export function c(x) {\n  return x + 300;\n}\n';
      writeFileSync(path.join(dir, 'src', 'g.ts'), changedG);

      const report = {
        schemaVersion: '1.0',
        projectRoot: dir,
        files: {
          'src/f.ts': {
            source: changed,
            mutants: [
              {
                id: 'm1',
                mutatorName: 'ArithmeticOperator',
                replacement: 'x - 100',
                status: 'Survived',
                coveredBy: ['t1'],
                testsCompleted: 1,
                location: { start: { line: 2, column: 10 }, end: { line: 2, column: 19 } },
              },
              {
                id: 'm2',
                mutatorName: 'ArithmeticOperator',
                replacement: 'x - 2',
                status: 'Survived',
                coveredBy: ['t1'],
                testsCompleted: 1,
                location: { start: { line: 6, column: 10 }, end: { line: 6, column: 17 } },
              },
            ],
          },
          'src/g.ts': {
            source: changedG,
            mutants: [
              {
                id: 'm3',
                mutatorName: 'ArithmeticOperator',
                replacement: 'x - 300',
                status: 'Killed',
                coveredBy: ['t1'],
                killedBy: ['t1'],
                testsCompleted: 1,
                location: { start: { line: 2, column: 10 }, end: { line: 2, column: 19 } },
              },
            ],
          },
        },
        testFiles: { 'test/f.test.ts': { tests: [{ id: 't1', name: 'f works' }] } },
      };
      const reportPathHere = path.join(dir, 'report.json');
      writeFileSync(reportPathHere, JSON.stringify(report));

      const cli = execFileSync('node', [digestPath, reportPathHere, '--since', ref, '--format', 'json'], {
        cwd: dir,
        encoding: 'utf8',
      });
      const scoped = JSON.parse(cli);
      assert.equal(scoped.scoped, true);
      assert.equal(scoped.stale.length, 0);
      assert.deepEqual(scoped.survivors.map((s) => s.id), [
        scoped.survivors.find((s) => s.line === 2).id,
      ]);
      // 1 survivor (`f.ts` line 2) + 1 killed (`g.ts` line 2, no survivor
      // of its own): a file with nothing left in survivors[] must still
      // contribute its killed count to the scoped summary.
      assert.equal(scoped.summary.total, 2);
      assert.equal(scoped.summary.killed, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  '--since marks a file stale, instead of filtering it, when its source no longer matches the report',
  { skip: !gitAvailable && 'git is not installed' },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'digest-since-stale-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });

      mkdirSync(path.join(dir, 'src'), { recursive: true });
      const original = 'export function a(x) {\n  return x + 1;\n}\n';
      writeFileSync(path.join(dir, 'src', 'f.ts'), original);
      spawnSync('git', ['add', '.'], { cwd: dir });
      spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
      const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      // The report describes one source; the file on disk has moved on
      // since, so its line numbers can no longer be trusted.
      const reportedSource = 'export function a(x) {\n  return x + 1;\n}\n';
      const currentOnDisk = 'export function a(x) {\n  return x + 999;\n}\n';
      writeFileSync(path.join(dir, 'src', 'f.ts'), currentOnDisk);

      const report = {
        schemaVersion: '1.0',
        projectRoot: dir,
        files: {
          'src/f.ts': {
            source: reportedSource,
            mutants: [
              {
                id: 'm1',
                mutatorName: 'ArithmeticOperator',
                replacement: 'x - 1',
                status: 'Survived',
                coveredBy: ['t1'],
                testsCompleted: 1,
                location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
              },
            ],
          },
        },
        testFiles: { 'test/f.test.ts': { tests: [{ id: 't1', name: 'f works' }] } },
      };
      const reportPathHere = path.join(dir, 'report.json');
      writeFileSync(reportPathHere, JSON.stringify(report));

      const result = spawnSync('node', [digestPath, reportPathHere, '--since', ref, '--format', 'json'], {
        cwd: dir,
        encoding: 'utf8',
      });
      const scoped = JSON.parse(result.stdout);
      assert.equal(scoped.survivors.length, 0, 'a stale file is dropped, not filtered by a wrong line');
      assert.deepEqual(scoped.stale, [
        { file: 'src/f.ts', reason: 'source no longer matches the report; cannot scope by line' },
      ]);
      assert.match(result.stderr, /warning: src\/f\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('--since exits 2 for an unknown git ref', { skip: !gitAvailable && 'git is not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'digest-since-badref-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const reportPathHere = path.join(dir, 'report.json');
    writeFileSync(reportPathHere, JSON.stringify({ schemaVersion: '1.0', files: {}, testFiles: {} }));
    const result = spawnSync('node', [digestPath, reportPathHere, '--since', 'not-a-real-ref'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatJsonl: stale files and fixed survivors are lines, and a survivor line says whether it is new', () => {
  const digest = buildDigest(loadReport());
  const [first, ...rest] = digest.survivors;
  digest.scoped = true;
  digest.stale = [{ file: 'src/c.ts', reason: 'source changed since the report' }];
  digest.baseline = {
    new_survivors: [{ id: first.id }],
    fixed_survivors: [{ id: 'aaaaaaaaaaaa', file: 'src/a.ts', line: 1, operator: 'StringLiteral' }],
  };
  const lines = formatJsonl(digest).split('\n').map((l) => JSON.parse(l));

  assert.deepEqual(lines[1], { kind: 'stale', file: 'src/c.ts', reason: 'source changed since the report' });
  const survivorLines = lines.filter((l) => l.kind === 'survivor');
  assert.equal(survivorLines.find((l) => l.id === first.id).new, true);
  for (const s of rest) assert.equal(survivorLines.find((l) => l.id === s.id).new, false);
  assert.deepEqual(lines.find((l) => l.kind === 'fixed_survivor'), {
    kind: 'fixed_survivor', id: 'aaaaaaaaaaaa', file: 'src/a.ts', line: 1, operator: 'StringLiteral',
  });
  const summary = lines.at(-1);
  assert.equal(summary.kind, 'summary');
  assert.equal(summary.stale_count, 1);
  assert.equal(summary.new_survivors, 1);
  assert.equal(summary.fixed_survivors, 1);
});

test('formatJsonl: one line per item, kind order survivor/unverified/timeout/no_coverage/ignored/invalid/test_without_kills, summary last', () => {
  const digest = buildDigest(loadReport());
  const lines = formatJsonl(digest).split('\n').map((l) => JSON.parse(l));

  assert.equal(lines[0].kind, 'run');
  assert.equal(lines[0].schema_version, '5.0');
  assert.equal(lines[0].tool, 'stryker');
  assert.equal(lines[0].report_schema_version, '1.0');
  assert.equal(lines[0].disable_bail, false);

  assert.equal(lines.at(-1).kind, 'summary');
  assert.equal(lines.at(-1).total, 10);

  const kinds = lines.slice(1, -1).map((l) => l.kind);
  const kindOrder = ['survivor', 'unverified', 'timeout', 'no_coverage', 'ignored', 'invalid', 'test_without_kills'];
  const seen = [...new Set(kinds)];
  assert.deepEqual(
    seen,
    kindOrder.filter((k) => seen.includes(k)),
    'each kind that appears keeps the fixed order',
  );

  // Kind counts match the corresponding arrays in --format json.
  assert.equal(kinds.filter((k) => k === 'survivor').length, digest.survivors.length);
  assert.equal(kinds.filter((k) => k === 'timeout').length, digest.timeouts.length);
  assert.equal(kinds.filter((k) => k === 'no_coverage').length, digest.no_coverage.length);
  assert.equal(kinds.filter((k) => k === 'ignored').length, digest.ignored.length);
  assert.equal(kinds.filter((k) => k === 'invalid').length, digest.invalid.length);
  assert.equal(kinds.filter((k) => k === 'test_without_kills').length, digest.tests_without_kills.length);

  // A survivor line carries the same fields as --format json's survivors[], plus `kind`.
  const survivorLine = lines.find((l) => l.kind === 'survivor' && l.replacement === 'total + 1');
  const jsonSurvivor = digest.survivors.find((s) => s.replacement === 'total + 1');
  const { kind: _kind, ...survivorFields } = survivorLine;
  assert.deepEqual(survivorFields, jsonSurvivor);
});

test('--format jsonl is the default, and --format json still produces the single-object shape', () => {
  const jsonlCli = runCli(['fixtures/report.json']);
  const jsonlLines = jsonlCli.stdout.trim().split('\n');
  assert.ok(jsonlLines.length > 2, 'jsonl output carries more than the run and summary lines alone');
  assert.equal(JSON.parse(jsonlLines[0]).kind, 'run');
  assert.equal(JSON.parse(jsonlLines.at(-1)).kind, 'summary');

  const jsonCli = runCli(['fixtures/report.json', '--format', 'json']);
  const parsed = JSON.parse(jsonCli.stdout);
  assert.equal(parsed.schema_version, '5.0');
  assert.ok(Array.isArray(parsed.survivors));
});

test('--baseline reads a JSONL baseline file the same as its JSON twin', () => {
  const jsonlCli = runCli([
    'fixtures/report.json',
    '--baseline',
    'fixtures/baseline-digest.jsonl',
    '--format',
    'json',
  ]);
  const jsonCli = runCli([
    'fixtures/report.json',
    '--baseline',
    'fixtures/baseline-digest.json',
    '--format',
    'json',
  ]);
  assert.equal(jsonlCli.exitCode, jsonCli.exitCode);
  assert.deepEqual(
    JSON.parse(jsonlCli.stdout).baseline,
    JSON.parse(jsonCli.stdout).baseline,
  );
});

test(
  '--since counts an untracked file as changed on every line, instead of silently passing its survivors',
  { skip: !gitAvailable && 'git is not installed' },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'digest-since-untracked-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      mkdirSync(path.join(dir, 'src'), { recursive: true });
      writeFileSync(path.join(dir, 'README.md'), 'placeholder\n');
      spawnSync('git', ['add', 'README.md'], { cwd: dir });
      spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
      const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      // src/new.ts is never `git add`ed: untracked.
      const source = 'export function n(x) {\n  return x + 1;\n}\n';
      writeFileSync(path.join(dir, 'src', 'new.ts'), source);

      const report = {
        schemaVersion: '1.0',
        projectRoot: dir,
        files: {
          'src/new.ts': {
            source,
            mutants: [
              {
                id: 'n1',
                mutatorName: 'ArithmeticOperator',
                replacement: 'x - 1',
                status: 'Survived',
                coveredBy: ['t1'],
                testsCompleted: 1,
                location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
              },
            ],
          },
        },
        testFiles: { 'test/new.test.ts': { tests: [{ id: 't1', name: 'n works' }] } },
      };
      const reportPathHere = path.join(dir, 'report.json');
      writeFileSync(reportPathHere, JSON.stringify(report));

      const result = spawnSync(
        'node',
        [digestPath, reportPathHere, '--since', ref, '--gate', '--format', 'json'],
        { cwd: dir, encoding: 'utf8' },
      );
      const scoped = JSON.parse(result.stdout);
      assert.equal(scoped.stale.length, 0);
      assert.equal(scoped.survivors.length, 1, 'an untracked file counts every line as changed');
      assert.equal(result.status, 1, 'the gate fails on the untracked file\'s survivor');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  '--since marks a file stale when git diff itself fails for it, and --gate exits 3',
  { skip: !gitAvailable && 'git is not installed' },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'digest-since-diff-fails-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      mkdirSync(path.join(dir, 'src'), { recursive: true });
      const original = 'export function a(x) {\n  return x + 1;\n}\n';
      writeFileSync(path.join(dir, 'src', 'f.ts'), original);
      spawnSync('git', ['add', 'src/f.ts'], { cwd: dir });
      spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
      const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

      // A real content change, so `git diff` must read the committed blob
      // to build a hunk (an unchanged file needs no blob read, and git
      // diff would exit 0 with no output even with the blob gone). The
      // report's own `source` is the new content, so the hash check
      // passes and this run reaches `git diff` at all.
      const source = 'export function a(x) {\n  return x + 100;\n}\n';
      writeFileSync(path.join(dir, 'src', 'f.ts'), source);

      // Delete the committed blob's loose object so `git diff <ref> -- src/f.ts`
      // fails trying to read it, without touching the index (`ls-files`
      // still reports the file tracked) or the working tree (its content
      // still matches the report's `source_hash`).
      const blobArg = `${ref}:src/f.ts`;
      const blob = execFileSync('git', ['rev-parse', blobArg], { cwd: dir, encoding: 'utf8' }).trim();
      rmSync(path.join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));

      const report = {
        schemaVersion: '1.0',
        projectRoot: dir,
        files: {
          'src/f.ts': {
            source,
            mutants: [
              {
                id: 'm1',
                mutatorName: 'ArithmeticOperator',
                replacement: 'x - 1',
                status: 'Survived',
                coveredBy: ['t1'],
                testsCompleted: 1,
                location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
              },
            ],
          },
        },
        testFiles: { 'test/f.test.ts': { tests: [{ id: 't1', name: 'f works' }] } },
      };
      const reportPathHere = path.join(dir, 'report.json');
      writeFileSync(reportPathHere, JSON.stringify(report));

      const result = spawnSync(
        'node',
        [digestPath, reportPathHere, '--since', ref, '--gate', '--format', 'json'],
        { cwd: dir, encoding: 'utf8' },
      );
      const scoped = JSON.parse(result.stdout);
      assert.equal(scoped.stale.length, 1);
      assert.equal(scoped.stale[0].file, 'src/f.ts');
      assert.match(scoped.stale[0].reason, /git diff failed/);
      assert.equal(result.status, 3, 'a stale file, like an unverified mutant, is a measurement gap');
      assert.match(result.stderr, /warning: src\/f\.ts.*git diff failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
