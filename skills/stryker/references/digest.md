# Read a Stryker report with digest.mjs

`scripts/digest.mjs` turns `reports/mutation/mutation.json` into a record
you can act on directly: a survivor list with a stable id, a diff, the
covering tests, and a command that reruns just that mutant. It reads the
report Stryker already wrote. It does not run Stryker, and it does not
edit source or test files.

Its `survivors[]` keys match Ruby's mutineer, so an agent reads both
tools' output the same way: `subject`, `file`, `line`, `operator`, `id`,
`token`, `diff`. Stryker's report carries more than mutineer's, so
`survivors[]` adds `location`, `replacement`, `tests`, and `rerun`.

## Run it

```
node <skill>/scripts/digest.mjs [report.json] [--baseline <previous digest.json>] [--format json|text] [--output <file>]
```

- `report.json` defaults to `reports/mutation/mutation.json`. An
  incremental run's `reports/stryker-incremental.json` uses the same
  schema, so digest.mjs reads it too, including a run stopped partway.
- `--baseline <file>`: compare this run's survivors against a digest.json
  from a previous run, matched by `id`.
- `--format json` (default): one line of JSON, shown below.
- `--format text`: a short block per survivor (`file:line subject
  operator id`, the diff, the rerun command), then one summary line.
- `--output <file>`: write to a file instead of standard output.
- Exit code: `0` on success. `1` when `--baseline` finds a new survivor.
  `2` on a usage error: an unreadable file, a `report_schema_version`
  that is not `1.x`, or an unknown flag.
- Progress and warnings go to standard error. Standard output carries
  only the digest.

## The output (`--format json`)

```jsonc
{
  "schema_version": "1.0",
  "source": { "tool": "stryker", "report_schema_version": "1.0", "disable_bail": false },
  "summary": { "total": 0, "killed": 0, "timeout": 0, "survived": 0, "no_coverage": 0, "compile_error": 0, "runtime_error": 0, "ignored": 0, "pending": 0, "score": null, "score_covered": null },
  "survivors": [],
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

### `summary`

The status counts, plus two scores. Following Stryker's own
mutation-testing-metrics package:

- `detected = killed + timeout`
- `valid = detected + survived + no_coverage`
- `score = detected / valid × 100`
- `score_covered = detected / (detected + survived) × 100`

Both scores round to 2 decimal places. When a score's denominator is 0,
the score is `null`, not `0`; a `0` would read as "every mutant
survived", which a 0-mutant run did not test.

### `survivors[]`

One entry per mutant with status `Survived`:

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
  digits. When the same tuple appears more than once in one file, each
  occurrence after the first gets an order-of-appearance number (starting
  at 0) appended before hashing. Neither the line nor the column feeds the
  hash, so editing another part of the file leaves the id unchanged. The
  order used to assign that number comes from every mutant in the file,
  of every status, sorted by source position — not from the report's own
  mutant order, and not from survivors alone — so an id stays stable
  even when a duplicate elsewhere in the file changes status.
- `token`: the original source the mutant replaces, cut from `location`,
  with runs of whitespace collapsed to one space.
- `replacement`: Stryker's `replacement`.
- `diff`: a unified-diff hunk: `@@ -L +L @@` for a one-line change, or
  `@@ -L,N +L,M @@` when the mutant spans more than one line on either
  side.
- `tests`: the tests in `coveredBy`, as `{ name, file }`, with `file`
  looked up from the report's `testFiles`. A test's location is not
  always in the report, so `line` appears only when the report has it.
- `rerun`: a command that reruns just this mutant's range:
  `npx stryker run --force --mutate "<file>:<sl>:<sc>-<el>:<ec>"`.

#### How `rerun`'s columns are derived

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

Tested with Stryker 10.0.0: the `rerun` command of one `CallExpression`
survivor instrumented exactly one mutant, and that mutant survived again.
A larger mutant that encloses the range, such as the `BlockStatement`
around the same call, stays out of the run.

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
run's `digest.json`. Matches this run's survivors against that file's
survivors by `id`:

- `new_survivors`: in this run, not in the baseline.
- `fixed_survivors`: in the baseline, not in this run.

Both are lists of `{ subject, file, line, operator, token, id }`. A
non-empty `new_survivors` sets the exit code to `1`.

## Compatibility

Adding a key to this output is a minor change. Removing a key, renaming
a key, or changing a key's meaning is a breaking change. A reader may
ignore a key it does not recognize.
