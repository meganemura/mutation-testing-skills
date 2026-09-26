# Troubleshoot mutineer

Measured on mutineer 1.0.2. Each entry gives the symptom, the cause, the
fix, and how to confirm it.

## 1. Every mutant is `no_coverage` or `uncapturable`, the score is N/A, and the exit code is 0

Symptom: `--verbose` shows `cannot load such file -- test_helper` (or
`spec_helper`), followed by `coverage skipped for …`, for every source
file. `summary.score` is `null`. Every mutant sits under `no_coverage`
or `uncapturable`: both were measured, on two projects.

Cause: mutineer's own load path, for its ordinary run, is `lib` alone
(`Config#load_paths`'s default; no `.mutineer.yml` key and no CLI flag
sets it directly). A test file that requires a helper outside `lib`
fails to load, so mutineer records the line as uncovered, not as a
crash. Only `--rails` (or `--boot`) searches for `test_helper.rb` and
adds its directory; the ordinary path does not.

Fix: set `RUBYOPT="-Itest -Ilib"` (`-Ispec -Ilib` for RSpec) on the
process running mutineer. Coverage capture and the per-mutant test run
are two separate stages, and each reads the load path differently:
coverage capture needs `test` on the path, for the `require` to
resolve; the mutant run additionally needs `lib`, because mutineer's own
`lib` entry does not carry over to it. `RUBYOPT=-Itest` alone clears the
`no_coverage` symptom but turns every attempted mutant into `errored`
(see entry 1a). When the project's own test helper already unshifts
`lib` onto `$LOAD_PATH`, `-Itest` alone is enough.

Confirm: rerun with `--verbose`; the load error and the
`coverage skipped for …` lines disappear, and `summary.no_coverage`
drops to the lines no test truly executes.

Reported to mutineer: https://github.com/davidteren/mutineer/issues/119

## 1a. Coverage works, but every mutant is `errored` with a `LoadError`

Symptom: `--verbose` no longer shows a `test_helper` load failure, but
`summary.errored` is high and `no_verdict[]` entries show
`cannot load such file -- <source name>`.

Cause: `RUBYOPT=-Itest` puts the test directory on the load path for
both stages, but mutineer's own `lib` entry, present during coverage
capture, is not present in the per-mutant run's `RUBYOPT`-driven
process. A source file the test reaches only through `require "<name>"`
(not a relative `require_relative`) fails to load there.

Fix: add `-Ilib` to `RUBYOPT`, alongside `-Itest`.

Confirm: rerun; `summary.errored` drops, and `no_verdict[]` no longer
shows the `LoadError`.

## 2. A second and later `--test` file is mutated instead of tested

Symptom: `per_source[]` lists a test file among the sources, and the
score reads far lower than expected.

Cause: `--test` takes one file per flag, as the help text says
("repeatable"). A second path placed after it on the command line is a
positional argument, that is, a source to mutate. This is mutineer's
design: pass `--test A --test B`.

Fix: give each test file its own `--test` flag. A shell glob such as
`--test test/*_test.rb`, or a variable that holds several paths, expands
to several paths after one flag and hits this.

Confirm: `per_source[]` lists only production source files.

## 2a. Run without `--test`, a `test_*.rb` file is not found

Symptom: mutineer prints `no test found by convention for <source>;
skipping`, then `no test files found by convention; pass --test or add
tests`, and exits 2.

Cause: without `--test`, mutineer pairs each source with a test by
convention, and for Minitest the convention is `test/<name>_test.rb`
(and `test/lib/<name>_test.rb`). Minitest's own `Minitest::TestTask`
also finds `test/**/test_*.rb`, and a suite that names its tests that
way gets no pairing.

Fix: pass each test file with its own `--test` flag.

Reported to mutineer: https://github.com/davidteren/mutineer/issues/120

## 3. A test using `capture_subprocess_io` always fails

Symptom: the run aborts with the unmutated suite not green:
`the unmutated suite is not green`.

Cause: mutineer replaces `$stdout` with a `StringIO` before it runs the
suite. Minitest's `capture_subprocess_io` reopens `$stdout` on a
temporary file, and reopening a `StringIO` raises
`TypeError: can't convert Tempfile into StringIO`.

Fix: leave the file that defines such a test out of the `--test` list
for the mutineer run. Run it under the project's own test task as
usual.

Confirm: reproduce by hand: set `$stdout = StringIO.new`, then run the
suite; the same `TypeError` appears without mutineer in the loop.

Report this to mutineer: `capture_subprocess_io` is part of Minitest's
own standard library, not an unusual pattern.

## 4. A leftover in the working directory fails later mutants

Symptom: after the first survivor that writes something to the working
directory, many later mutants fail a test whose teardown checks that no
such thing exists, whatever the mutant actually changed.

Cause: mutineer runs every mutant's tests in the same working directory.
A mutant that causes the code to write to disk leaves that write in
place, and any later mutant's run inherits it.

Fix: in the teardown, remove only what that specific test run created,
before the test's own assertions can fail on it; do not remove anything
that was already present before the test started. Confirm with
`git status` after a full run, to see what a run leaves behind.

Confirm: rerun; the count of survivors caused only by the leftover
drops, once the teardown cleans up before asserting.

## 5. The default strategy reports a false kill

Symptom: a mutant reads as `killed`, but applying the same change by
hand leaves the unmutated suite green.

Cause: the default strategy, `reload`, writes the whole mutated file to
a temporary file in the same directory and `load`s it, running the
file's top-level code again. `--strategy redefine` instead reloads only
the mutated method, parsed out with Prism.

Fix: run with `--strategy redefine`.

Confirm: run the same mutant under both strategies and compare
`survivors[].id`; a mutant `killed` only under `reload` is a false kill.

## 6. Many `already initialized constant` warnings

Symptom: the run's output carries a large number of Ruby's
`already initialized constant` warnings, under either strategy.

Cause: before running the suite, mutineer `load`s the mutated source
once, for the clean check and for coverage capture. `load` does not
record the file in `$LOADED_FEATURES`, so a later `require` of the same
file, from the test suite itself, loads it again.

Fix: none yet. Most of these warnings are harmless. Read the top level
of the source file to judge whether it sets state (a constant that
should be assigned only once, for example); if it does, a run's result
for that file needs closer reading.

Report this to mutineer: loading a mutated source through `load` and
then again through the suite's own `require` is inherent to how
mutineer checks and captures coverage, and a project has no setting to
avoid it.

## 7. Fixing survivors while a run is in progress

mutineer mutates and runs tests against the project's own working tree;
it does not copy the tree to a separate place first. It swaps a source
file's mutated bytes in and restores the original, and, from 1.0.1 on,
holds one exclusive lock per source file while it does so. The `reload`
strategy also writes its temporary, whole-file copy under `lib/`, beside
the source it mutates. A second process that edits a source file in the
same working tree, while a run is in progress, conflicts with that
lock and with those temporary files. A second process that edits a test
file also changes what the running suite executes, because there is no
separate copy to insulate the run.

`references/general/operations.md`'s section on fixing survivors while
a run is still going assumes a tool that copies the project elsewhere
before it starts. mutineer does not have that property, so that
section's approach does not apply here.

## 8. `--output` fails with "no such directory"

Symptom: `cannot write to .mutineer/run.json: no such directory`.

Cause: mutineer does not create the output path's directory.

Fix: create the directory before the run
(`mkdir -p` the directory that holds `--output`'s path).
