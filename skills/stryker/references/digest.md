# Read a Stryker report with digest.mjs

`scripts/digest.mjs` turns `reports/mutation/mutation.json` into a record
you can act on directly: a survivor list with a stable id, a `git
apply`-ready patch, the covering tests, and a command that reruns just
that mutant. It reads the report Stryker already wrote. It does not run
Stryker, and it does not edit source or test files.

Its default output is JSONL: one JSON value per line, so a survivor, a
timeout, or the summary is a `grep` or a `jq` filter away, with no need
to parse the whole file first. See "The output (`--format jsonl`)"
below. `--format json` still produces the single-object shape schema
`4.0` and earlier always wrote, for a reader that wants the whole digest
as one value.

Each item's own keys are modeled on Ruby's mutineer's own `survivors[]`
list (`subject`, `file`, `line`, `operator`, `id`), so an agent that has
read mutineer's output already knows most of the shape. `patch` matches
mutineer's `diff` in role, but carries a `git apply`-ready unified diff
instead of a bare hunk. Stryker's report carries more than mutineer's, so
a survivor adds `location`, `token`, `replacement`, `tests`, `rerun`,
`rerun_exact`, and `source_hash`.

`--since` narrows the digest to a git ref's changed lines, and `--gate`
turns it into a pass/fail check, so the same script also serves a PR's
changed-line gate; see "Scoping to changed lines" and "The PR gate"
below. `references/general/operations.md` sets out where each of a
project's mutation-testing layers — an agent's own local run, this gate,
and a nightly full run — fits.

## Run it

```
node <skill>/scripts/digest.mjs [report.json] [--baseline <previous digest.json>] [--since <git ref>] [--gate] [--format jsonl|json|text|github] [--output <file>]
```

- `report.json` defaults to `reports/mutation/mutation.json`. An
  incremental run's `reports/stryker-incremental.json` uses the same
  schema, so digest.mjs reads it too, including a run stopped partway.
- `--baseline <file>`: compare this run's survivors against a previous
  run's digest, matched by `id`. The file may be either shape digest.mjs
  writes: `--format jsonl` or `--format json`; both use the same field
  names for a survivor, so digest.mjs tells them apart by whether the
  first line parses as its own JSON value with `"kind":"run"`. The
  baseline's `schema_version` must be `4.0` or newer: schema `4.0`
  changed the id's own material (see `survivors[]` below), so an id from
  an older baseline cannot match an id here; `5.0` did not touch the id
  again (see "Schema versions" below). A mismatch prints no digest,
  warns, and exits `2`, rather than silently reporting every survivor as
  new.
- `--since <git ref>`: narrow `survivors[]`, `unverified[]`,
  `no_coverage[]`, and `timeouts[]` to the mutants whose line range
  overlaps a line `git diff --unified=0 <ref> -- <file>` added or changed
  in the working tree, one file at a time. See "Scoping to changed
  lines" below.
- `--gate`: turn the digest into a pass/fail check for a PR. See "The PR
  gate" below.
- `--format jsonl` (default): one JSON value per line, shown below in
  "The output (`--format jsonl`)".
- `--format json`: the whole digest as one JSON value, shown below in
  "The output (`--format json`)".
- `--format text`: a short block per survivor (`file:line subject
  operator id`, the patch, `rerun`, `rerun_exact`), then one summary
  line. When `unverified[]` is not empty, one more line follows the
  summary: `N survivors ran no test; fix the measurement first. See
  unverified[].`
- `--format github`: one GitHub Actions workflow command per flagged
  mutant, for a check to annotate directly on the changed lines. See
  "`--format github`" below.
- `--output <file>`: write to a file instead of standard output.
- Exit code: `0` on success. `1` when `--baseline` finds a new survivor,
  or `--gate` finds a survivor or an uncovered mutant. `2` on a usage
  error: an unreadable file, a `report_schema_version` that is not
  `1.x`, a `--baseline` file whose `schema_version` is older than `4.0`,
  an unknown flag, or, with `--since`, a missing `git` or an unknown ref.
  `3` when `--gate` finds an unverified mutant, or a file `--since`
  marked stale (see "Scoping to changed lines" below): both are a
  measurement failure, kept apart from a real survivor so neither is
  read as a test failure.
- Progress and warnings go to standard error. Standard output carries
  only the digest.

## The output (`--format jsonl`)

One JSON value per line, in this fixed order: a `run` line, then every
item, kind by kind, then a `summary` line last.

```jsonl
{"kind":"run","schema_version":"5.0","tool":"stryker","report_schema_version":"1.0","disable_bail":false}
{"kind":"survivor","subject":"add","file":"src/a.ts","line":5,"location":{"start":{"line":5,"column":13},"end":{"line":5,"column":22}},"operator":"ArithmeticOperator","id":"7e29b57b81eb","token":"total - 1","replacement":"total + 1","patch":"...","source_hash":"...","tests":{"total":1,"truncated":false,"files":[]},"rerun":"...","rerun_exact":"..."}
{"kind":"timeout","subject":"risky","file":"src/b.ts","line":6,"id":"...","operator":"ConditionalExpression","token":"x < 0","static":false,"status_reason":"..."}
{"kind":"test_without_kills","name":"unused test","file":"test/b.test.ts"}
{"kind":"summary","total":10,"killed":2,"timeout":1,"survived":3,"no_coverage":1,"compile_error":1,"runtime_error":1,"ignored":1,"pending":0,"unverified":0,"score":42.86,"score_covered":50,"score_excluding_unverified":42.86}
```

Every key is snake_case, on every line.

- **The `run` line** carries this output's schema version
  (`schema_version`, `"5.0"`), the tool name, the input report's own
  schema version (`report_schema_version`), and the report's
  `config.disableBail` (`disable_bail`).
- **A `stale` line**, one per file, comes right after the `run` line
  when `--since` could not trust a file: `{"kind":"stale", file,
  reason}`. See "Scoping to changed lines" below.
- **An item line** is `{"kind": <kind>, ...}`, where the rest of the
  object is exactly that item's fields from `--format json`, described
  under `survivors[]`, `unverified[]`, `no_coverage[]`, `timeouts[]`,
  `ignored[]`, `invalid[]`, and `tests_without_kills[]` below. `kind` is
  `survivor`, `unverified`, `timeout`, `no_coverage`, `ignored`,
  `invalid`, or `test_without_kills`. Items appear kind by kind, in that
  fixed order, and within a kind in the same order `--format json`'s
  array uses. With `--baseline`, each `survivor` line also carries
  `new`: `true` when the baseline did not have it.
- **A `fixed_survivor` line**, with `--baseline`, follows the items for
  each baseline survivor this run no longer has: `{"kind":
  "fixed_survivor", subject, file, line, operator, id}`.
- `per_source[]` has no line of its own: it is a file-level rollup, not
  a per-mutant record. Read it from `--format json`.
- **The `summary` line** carries the same keys as `--format json`'s
  `summary` object. With `--since` it adds `scoped: true` and
  `stale_count`; with `--baseline` it adds the counts `new_survivors`
  and `fixed_survivors`.
- **A missing `summary` line means the write of this JSONL output did
  not finish.** digest.mjs itself writes its whole output in one
  operation, so its own JSONL file or standard-output stream normally
  never stops before the `summary` line; a truncated file here points to
  the process being killed mid-write, or a disk running out of space.
  This convention exists for the tool this output feeds, which can write
  survivor lines to a file incrementally while a mutation-testing run is
  still in progress; there, the `summary` line's absence is the normal
  and expected way to tell a still-running file from a finished one. A
  `pending` count above `0` in `summary` says something different: the
  input report itself came from a Stryker run that stopped before every
  mutant finished, not that this digest's own write is incomplete.

Read it with standard tools, no library needed:

```
grep '"file":"src/x.ts"' agent.jsonl        # every line about one file
jq -c 'select(.kind=="survivor")' agent.jsonl  # every survivor, one JSON object per line
tail -n 1 agent.jsonl                        # the summary, once the run has one
```

## The output (`--format json`)

```jsonc
{
  "schema_version": "5.0",
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
  "baseline": { "new_survivors": [], "fixed_survivors": [] },
  "scoped": false,
  "stale": []
}
```

`baseline` is present only with `--baseline`. `scoped` and `stale` are
present only with `--since` (see "Scoping to changed lines" below).

`schema_version` is `5.0`. It changed from `4.0` because `--format
jsonl` became the default output (see "The output (`--format jsonl`)"
above) and `--gate` gained a third failure case, `stale[]` (see "The PR
gate" below); neither touches `id`'s own material or any existing key's
meaning, so a `5.0` id still matches a `4.0` digest's id for the same
mutant, and a `4.0` `--baseline` file is still accepted (see "Run it"
above).

It changed from `3.0` to `4.0` because `id`'s own material changed: a
`4.0` id is built from the mutant's enclosing line text instead of
`subject`, and `survivors[]` and `unverified[]` regained a `token` field
(for `--format github`'s message). Both changes are breaking: a `4.0` id
does not match a `1.0`, `2.0`, or `3.0` digest's id for the same mutant,
unlike every earlier bump (see "The id" below). A `--baseline` file whose
`schema_version` is older than `4.0` is rejected (see "Run it" above),
rather than compared and silently reporting every survivor as new.

It changed from `2.0` to `3.0` because `survivors[]` and `unverified[]`
replaced `tests`'s flat test list with the `{ total, truncated, files }`
summary described below, a breaking change to a reader that keys off the
old `tests` shape. It changed from `1.0` to `2.0` because `survivors[]`
dropped `token` and `diff` for `patch`, and because a run's own `rerun`
key changed meaning (see `survivors[]` below).

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
- `id`: a stable id. See "The id" below.
- `token`: the mutated source text, collapsed to single spaces (see
  below). Feeds `--format github`'s message; also usable as a quick
  before/after check without parsing `patch`.
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
  list — on one project's full report (3,689 survivors), listing every
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

#### The id

`id` is the first 12 hex digits of a sha1 whose material, joined with
`"\0"`, is:

1. `file`: the report's key under `files`.
2. The full text of every line the mutant's location spans, each line
   trimmed of its own leading and trailing whitespace and, for a
   multi-line span, joined with `"\n"`.
3. `token` (above): the mutated text itself.
4. `operator`: Stryker's `mutatorName`.
5. `replacement`: Stryker's `replacement`.
6. A column ordinal: among mutants on the *same physical line* that
   share materials 2 through 5, the order by column, starting at 0. A
   line can carry two mutable spots with an identical rewrite (`total =
   total + step + step`, both `+`s flipped to `-`); this tells them
   apart.
7. Present only when it is still needed: an occurrence ordinal, among
   mutants whose materials 2 through 6 all still match, in the order
   their line appears in the file, starting at 0. A line's exact text
   can repeat elsewhere in the file (duplicated code), each copy
   producing an identical mutant at the same column ordinal; this tells
   those copies apart.

Neither ordinal is a raw line or column number, and neither is
`subject`: all three would shift with unrelated indentation, an edit
elsewhere in the file, or an unrelated rename of the enclosing function —
exactly the instability this id exists to avoid. `subject` in particular
was id material through schema `3.0`; it is dropped from the id in `4.0`
(it stays as its own field, above), because the line text already
carries most of its distinguishing power. Without `subject`, a report's
digest and a reporter running live inside Stryker compute the same id
straight from the same report fields, with no source scan of their own
to keep in step.

This id's material was chosen from a measurement on a 14,140-mutant
report: keying on (file, token, operator, replacement) alone collided
for 4,261 mutants (30%) — the same token recurs at unrelated call sites
in a large file. Adding `subject` narrowed that to 2,324 (16%).
Replacing `token` with the mutant's enclosing line text — keying on
(file, line text, operator, replacement) instead — narrowed it further,
to 1,163 (8%). This id keeps `token` in addition to the line text
(material 3, above), and adds materials 6 and 7 to resolve what
collisions remain: on the same 14,140-mutant report, digest.mjs measures
557 mutants (4%) with a non-zero material-7 ordinal — mutants whose
(file, line text, token, operator, replacement, column ordinal) all
matched at least one other mutant in the file, so the occurrence ordinal
was the only thing telling them apart. This is the id's known remaining
weak point: reordering a file's duplicate lines, or adding another copy
earlier in the file, shifts material 7, and so the id, for every copy of
that line after the change. `--baseline` reads this as an unrelated
survivor fixed and a new one introduced, for what was really the same
mutant moving. There is no complete fix within a line-text key: two
duplicate lines are, by definition, indistinguishable from their text
alone.

`id`'s schema changed once already without changing this material: a
`1.0` digest's `id` for a mutant still matched a `2.0` or `3.0` digest's
`id` for the same mutant. `4.0` breaks that: dropping `subject` and
adding the line text changes every id, so a `4.0` digest's `id` does not
match a `1.0`, `2.0`, or `3.0` digest's `id` for the same mutant (see
"Run it" above for what `--baseline` does about this).

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
location, id, operator, token, replacement }`. No test executed this
code at all. `location` and `replacement` were added in schema `4.0`, for
`--format github` and `--since`; they carry the same meaning as in
`survivors[]`.

### `timeouts[]`

One entry per mutant with status `Timeout`: `{ subject, file, line, id,
operator, token, static, status_reason }`. Stryker counts a timeout as
detected, the same as a kill, but a short time limit can time out a
mutant that a longer limit would kill outright. Read `status_reason`
before trusting the count. `static` (added in schema `4.0`) is copied
from the report's own `mutant.static`. `--gate` counts a static timeout
separately, in a warning, rather than treating it as an ordinary timeout
(see "The PR gate" below): a static mutant's timeout is a measurement
concern to reread, not a proven gap in the test suite.

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

## Scoping to changed lines

`--since <ref>` narrows `survivors[]`, `unverified[]`, `no_coverage[]`,
and `timeouts[]` to the mutants whose line range overlaps a line
`git diff --unified=0 <ref> -- <file>` reports as added or changed in
the working tree, one `git diff` per file in the report — every file,
not just one with a survivor, so a file whose remaining mutants were all
killed on a changed line still counts them. `summary` is recomputed from
the narrowed set, and `scoped: true` is added.

The report's line numbers describe the source Stryker mutated, not
necessarily the file on disk right now. Before scoping a file,
`--since` compares that file's current content against the report's own
`source_hash` for it. A mismatch means the file has moved on since the
report was built, so its line numbers can no longer be trusted: rather
than filter it on a wrong line, `--since` drops every entry for that
file and adds it to `stale[]`, `{ file, reason }`, with a matching
warning on standard error. Run Stryker again before trusting `--since`
for a file in `stale[]`.

A file `git diff <ref> -- <file>` itself fails to read — for example, a
shallow clone missing the commit's history, or a corrupt object — also
goes to `stale[]`, with `reason` starting `git diff failed:` and the
first line of git's own error message. This is a different case from a
content mismatch above: the working tree and the report agree, but
`--since` still cannot tell which of the file's lines changed, so it is
untrustworthy in the same way.

A file the report names that git does not track at all (never
`git add`ed, so it has no history to diff against) is not stale: `--since`
counts its every line as changed instead. Otherwise `git diff` would
report no change for a file with no commit to compare against, and a
brand-new file's own survivor would silently pass the gate — the one
change a changed-line gate exists to catch.

`--since` needs `git` on `PATH` and a ref that resolves to a commit; a
missing `git` or an unknown ref exits `2` before reading the report
further.

`ignored[]`, `invalid[]`, `per_source[]`, and `tests_without_kills[]` are
not scoped: an ignored or invalid mutant is a judgment already made in
source, and `per_source[]` and `tests_without_kills[]` are file-level and
suite-level views a line range does not narrow meaningfully.

## The PR gate

`--gate` turns the digest into a pass/fail check, typically alongside
`--since` so the check is scoped to a PR's own changed lines:

- Exit `1` when `survivors[]` or `no_coverage[]` is not empty: a changed
  line has a mutant nothing kills.
- Exit `3` when `unverified[]` is not empty, or `stale[]` is not empty:
  a changed line's mutant could not be verified at all, or a whole file
  could not be scoped at all. Both are kept apart from exit `1` because
  each names a measurement failure, not a proven hole in the suite; do
  not read either as a test failure. Fix the measurement (see
  `references/troubleshooting.md`), then rerun.
- Exit `0` otherwise.

`timeouts[]` never fails the gate: Stryker already counts a timeout as
detected. A `static` timeout (see `timeouts[]` above) still warrants a
second look, since it is a measurement concern rather than a proven
gap; `--gate` prints its count as a warning on standard error without
failing the gate on it, so it does not silently pass as an ordinary
kill either.

## `--format github`

Renders `survivors[]` and `no_coverage[]` as GitHub Actions `::error`
workflow commands, and `unverified[]` as `::warning`, one per line, so a
PR's check can annotate the exact line:

```
::error file=<file>,line=<line>,endLine=<end line>,title=<operator> survived::<token> -> <replacement>
::warning file=<file>,line=<line>,endLine=<end line>,title=unverified::no test ran for this mutant
```

A `%`, a carriage return, or a newline inside a file path, `token`, or
`replacement` is escaped per GitHub's own workflow-command rule
(`%` → `%25`, `\r` → `%0D`, `\n` → `%0A`), so a multi-line replacement or
a `%` in source text does not corrupt the command. `timeouts[]` is left
out: see "The PR gate" above for why a timeout does not gate a PR either.

## Schema versions

| `schema_version` | Changed |
| --- | --- |
| `1.0` | First release. |
| `2.0` | `survivors[]` dropped `token` and `diff` for `patch`; `rerun`'s meaning changed. `id` unchanged. |
| `3.0` | `survivors[]` and `unverified[]`'s `tests` became `{ total, truncated, files }`. `id` unchanged. |
| `4.0` | `id`'s material changed: dropped `subject`, added the enclosing line's text (see "The id" above). `survivors[]`, `unverified[]`, and `no_coverage[]` regained `token`; `no_coverage[]` gained `location` and `replacement`; `timeouts[]` gained `static`. Added `--since`, `--gate`, `--format github`. **`id` changed for every mutant**; a `--baseline` file must be `4.0` or newer. |
| `5.0` | `--format jsonl` (see "The output (`--format jsonl`)" above) became the default output, in place of `--format json`; `--format json` is unchanged and still available. `--gate` gained a third exit-`3` case, a `stale[]` entry (see "The PR gate" above); `--since` stopped silently passing an untracked file's survivors, and now marks a file `stale[]` when `git diff` itself fails for it (see "Scoping to changed lines" above). `id` unchanged; a `--baseline` file from `4.0` is still accepted. |

## Compatibility

Adding a key to this output is a minor change. Removing a key, renaming
a key, or changing a key's meaning is a breaking change. A reader may
ignore a key it does not recognize.
