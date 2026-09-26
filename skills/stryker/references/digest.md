# Read a Stryker report with digest.mjs

`scripts/digest.mjs` turns `reports/mutation/mutation.json` into a record
you can act on directly: a survivor list with a stable id, a `git
apply`-ready patch, the covering tests, and a command that reruns just
that mutant. It reads the report Stryker already wrote. It does not run
Stryker, and it does not edit source or test files.

Its `survivors[]` keys are modeled on Ruby's mutineer's own
`survivors[]` list (`subject`, `file`, `line`, `operator`, `id`), so an
agent that has read mutineer's output already knows most of the shape.
`patch` matches mutineer's `diff` in role, but carries a `git
apply`-ready unified diff instead of a bare hunk. Stryker's report
carries more than mutineer's, so `survivors[]` adds `location`,
`replacement`, `tests`, `rerun`, `rerun_exact`, and `source_hash`.

## Run it

```
node <skill>/scripts/digest.mjs [report.json] [--baseline <previous digest.json>] [--format json|text] [--output <file>]
```

- `report.json` defaults to `reports/mutation/mutation.json`. An
  incremental run's `reports/stryker-incremental.json` uses the same
  schema, so digest.mjs reads it too, including a run stopped partway.
- `--baseline <file>`: compare this run's survivors against a digest.json
  from a previous run, matched by `id`. Reads a `1.x` digest as well as a
  `2.x` one; `id` did not change between schema versions.
- `--format json` (default): one line of JSON, shown below.
- `--format text`: a short block per survivor (`file:line subject
  operator id`, the patch, `rerun`, `rerun_exact`), then one summary
  line. When `unverified[]` is not empty, one more line follows the
  summary: `N survivors ran no test; fix the measurement first. See
  unverified[].`
- `--output <file>`: write to a file instead of standard output.
- Exit code: `0` on success. `1` when `--baseline` finds a new survivor.
  `2` on a usage error: an unreadable file, a `report_schema_version`
  that is not `1.x`, or an unknown flag.
- Progress and warnings go to standard error. Standard output carries
  only the digest.

## The output (`--format json`)

```jsonc
{
  "schema_version": "3.0",
  "source": { "tool": "stryker", "report_schema_version": "1.0", "disable_bail": false },
  "summary": { "total": 0, "killed": 0, "timeout": 0, "survived": 0, "no_coverage": 0, "compile_error": 0, "runtime_error": 0, "ignored": 0, "pending": 0, "unverified": 0, "score": null, "score_covered": null, "score_excluding_unverified": null },
  "survivors": [],
  "unverified": [],
  "no_coverage": [],
  "timeouts": [],
  "invalid": [],
  "ignored": [],
  "per_source": [],
  "tests_without_kills": [],
  "baseline": { "new_survivors": [], "fixed_survivors": [] }
}
```

`baseline` is present only with `--baseline`.

`schema_version` is `3.0`. It changed from `2.0` because `survivors[]`
and `unverified[]` replaced `tests`'s flat test list with the
`{ total, truncated, files }` summary described below, a breaking change
to a reader that keys off the old `tests` shape. It changed from `1.0` to
`2.0` because `survivors[]` dropped `token` and `diff` for `patch`, and
because a run's own `rerun` key changed meaning (see `survivors[]`
below). `id` did not change across any of these: a `3.0` digest's
survivor carries the same `id` a `1.0` or `2.0` digest gave the same
mutant, so a `1.0` or `2.0` baseline still matches a `3.0` run's
survivors (see `baseline` below).

### `summary`

The status counts, plus three scores. Following Stryker's own
mutation-testing-metrics package for the first two:

- `detected = killed + timeout`
- `valid = detected + survived + no_coverage`
- `score = detected / valid × 100`
- `score_covered = detected / (detected + survived) × 100`

`unverified` counts the mutants that moved from `survivors[]` to
`unverified[]` (see below); Stryker's own metrics count an unverified
mutant as survived, so `survived`, `score`, and `score_covered` already
include it, unchanged from a report with no `unverified[]` entries.
`score_excluding_unverified` answers a different question, "how good is
the suite once the measurement gap is set aside": `detected / (valid -
unverified) × 100`.

All three scores round to 2 decimal places. When a score's denominator is
0, the score is `null`, not `0`; a `0` would read as "every mutant
survived", which a 0-mutant run did not test.

### `survivors[]`

One entry per mutant with status `Survived`, except a mutant `unverified[]`
claims (see below):

- `subject`: the name of the enclosing function, method, or class member,
  found by scanning the source upward from the mutant's line for a
  function declaration, a method signature, or a `const`/`let` arrow or
  function assignment. A class method reads as `Class#method`. This is a
  regular-expression scan, not a parser: it can miss an unusual
  declaration shape or a deeply nested arrow function. `null` when no
  enclosing name is found.
- `file`: the report's key under `files`, Stryker's own relative path.
- `line`: 1-based, the mutant's start line.
- `location`: `{ start: { line, column }, end: { line, column } }`,
  copied from the report. Both `line` and `column` are 1-based; `end` is
  exclusive (it points just past the last character the mutant covers).
- `operator`: Stryker's `mutatorName`.
- `id`: a stable id. `sha1(file + "\0" + (subject ?? "") + "\0" + token +
  "\0" + operator + "\0" + replacement)`, kept to its first 12 hex
  digits, where `token` is the same source text `1.0` digests carried in
  a `token` field (see below), used here only to build the id. When the
  same tuple appears more than once in one file, each occurrence after
  the first gets an order-of-appearance number (starting at 0) appended
  before hashing. Neither the line nor the column feeds the hash, so
  editing another part of the file leaves the id unchanged. The order
  used to assign that number comes from every mutant in the file, of
  every status, sorted by source position — not from the report's own
  mutant order, and not from survivors alone — so an id stays stable even
  when a duplicate elsewhere in the file changes status. This id has not
  changed since schema `1.0`: a `1.0` digest's `id` for a mutant still
  matches the `2.0` digest's `id` for the same mutant.
- `replacement`: Stryker's `replacement`.
- `patch`: a `git apply`-ready unified diff: `--- a/<file>\n+++
  b/<file>\n@@ -<L>,<N> +<L>,<M> @@\n-<original lines>...\n+<replaced
  lines>...\n`. It carries no context lines, so apply it with `git apply
  --unidiff-zero`; plain `git apply` rejects a zero-context hunk unless it
  happens to sit at the end of the file (checked against real git).
- `source_hash`: the first 16 hex digits of the sha256 of
  `files[<file>].source`, the same for every survivor from that file.
  `rerun_exact` (below) encodes this run's source positions; compare this
  hash against the file's current content before trusting them:

  ```
  node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv[1])).digest('hex').slice(0,16))" <file>
  ```

- `tests`: a file-level summary of the tests in `coveredBy`, not the full
  list — on solarsql's full report (3,689 survivors), listing every
  covering test made a 44MB digest, unreadable by an agent. Shape:
  `{ total, truncated, files }`.
  - `total`: the number of covering tests, before any truncation.
  - `files`: one entry per file the covering tests came from,
    `{ file, count, names }`, `count`-descending, ties broken by `file`
    name. At most 10 entries (`MAX_TEST_FILES` in digest.mjs).
  - `names`: the covering test names in that file, alphabetical. At most
    3 (`MAX_TEST_NAMES_PER_FILE`). A test's location is left out even
    when the report has it, so every entry keeps the same shape.
  - `truncated`: `true` when `files` left out an 11th-or-later file, or
    when any listed file's `names` left out a 4th-or-later name.
- `rerun`: a command that reruns this mutant's file in Stryker's own
  incremental mode: `npx stryker run --incremental --mutate "<file>"`.
  Incremental mode realigns a mutant's position from the source diff and
  retries a surviving mutant whose tests changed, so this command stays
  correct after you edit the file.
- `rerun_exact`: a command that reruns just this mutant's exact range from
  this run: `npx stryker run --force --mutate
  "<file>:<sl>:<sc>-<el>:<ec>"`. Correct only while `source_hash` still
  matches the file; a source edit shifts or removes the range.

#### How `rerun_exact`'s columns are derived

The report's `location` is 1-based with an exclusive end: slicing a
source line from `start.column - 1` to `end.column - 1` yields the exact
mutated text (checked against a real report).

Stryker's `--mutate` range uses a different convention, despite its own
docs calling the end column "included". Its CLI parser reads the range's
column digits with no adjustment, and the instrumenter's inclusion check
compares that value directly against each AST node's own location, which
Babel numbers from 0. The report writer is the one place that shifts
this: it adds 1 to both the start and the end column when it builds the
report. So converting a report location to a `--mutate` range means
subtracting 1 from both columns; the line does not change. Because the
inclusion check accepts a range whose end equals the node's own end, a
range built this way always includes the intended mutant. It also
includes any other mutant inside the same source range.

Tested with Stryker 10.0.0: the `rerun_exact` command of one
`CallExpression` survivor instrumented exactly one mutant, and that
mutant survived again. A larger mutant that encloses the range, such as
the `BlockStatement` around the same call, stays out of the run.

### `unverified[]`

Same shape as `survivors[]`. Holds a mutant whose status is `Survived`,
whose `coveredBy` is not empty, and whose `testsCompleted` is `0`: a test
covers the mutant, and the mutant survived, yet not one of its covering
tests actually ran during that mutant's own test run. This is a
measurement gap, not a hole in the test suite. It has a known cause with
Stryker's vitest-runner 10.0.0 paired with Vitest 5: the runner selects
no test at all for a mutant inside a `describe` block (stryker-js issue
#6210). See "Vitest 5: every mutant with per-test coverage survives, and
no test runs" in `troubleshooting.md`. Do not write a test for an entry
in `unverified[]`; fix the measurement, then rerun.

### `no_coverage[]`

One entry per mutant with status `NoCoverage`: `{ subject, file, line,
id, operator, token }`. No test executed this code at all.

### `timeouts[]`

One entry per mutant with status `Timeout`: `{ subject, file, line, id,
operator, token, status_reason }`. Stryker counts a timeout as detected,
the same as a kill, but a short time limit can time out a mutant that a
longer limit would kill outright. Read `status_reason` before trusting
the count.

### `invalid[]`

One entry per mutant with status `CompileError` or `RuntimeError`:
`{ subject, file, line, id, status, status_reason }`.

### `ignored[]`

One entry per mutant with status `Ignored`: `{ subject, file, line, id,
operator, token, reason }`, where `reason` is the report's
`statusReason`.

### `per_source[]`

One entry per file: `{ file, total, killed, timeout, survived,
no_coverage, score }`, using the same score formula as `summary`.

### `tests_without_kills[]`

Tests that do not appear in any mutant's `killedBy`: `{ name, file }`.

When `source.disable_bail` is `false` (the report's `config.disableBail`
is `false`), Stryker records only the first test that failed for each
mutant, so a test elsewhere in `coveredBy` for the same mutant can have
killed it too without appearing in `killedBy`. Read this list as
candidates for review, not as tests to remove: a test can hold value a
mutation run does not measure, such as a type check or a check outside
`src`. Rerunning with `disableBail` gives an exact list.

### `status_reason` and `reason`

Both are cleaned before output: a sandbox run's path segment
(`.stryker-tmp/sandbox-<alphanumeric>/`) is removed, a query string such
as `?vitest=<digits>` is removed, and a `file://<projectRoot>/` prefix
becomes a relative path.

### `baseline`

Present only with `--baseline <file>`, where `<file>` is a previous
run's `digest.json`. Matches this run's `survivors[]` against that file's
`survivors[]` by `id`:

- `new_survivors`: in this run, not in the baseline.
- `fixed_survivors`: in the baseline, not in this run.

Both are lists of `{ subject, file, line, operator, id }`. A non-empty
`new_survivors` sets the exit code to `1`.

`unverified[]` never enters `new_survivors`, on either side of the
comparison: a mutant this run could not verify is not a new survivor to
fix, and a mutant the baseline run could not verify is not a survivor
this run fixed. A survivor that was verified in the baseline run and is
unverified in this run is left out of `fixed_survivors`: it ran no test
this time, so its absence says nothing about a fix. Find it in this
run's own `unverified[]`.

## Compatibility

Adding a key to this output is a minor change. Removing a key, renaming
a key, or changing a key's meaning is a breaking change. A reader may
ignore a key it does not recognize.
