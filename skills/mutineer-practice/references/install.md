# Install and configure mutineer

Follow these steps in order.

## 1. Check the Ruby version

mutineer parses Ruby with Prism, from the standard library, so it needs
Ruby 3.4 or later. When the target application runs on an older Ruby,
read the author's README for `--test-command`, which runs the suite as a
subprocess in the application's own Ruby.

## 2. Survey the project

Before you configure anything, check:

- Whether the tests `require "test_helper"` or `spec_helper`. mutineer's
  default load path is `lib` only; a test that requires a helper outside
  `lib` fails to load unless you add its directory to the load path.
- Whether a test uses Minitest's `capture_subprocess_io`. mutineer
  replaces `$stdout` with a `StringIO` before it runs the tests; such a
  test fails against the unmutated suite. See
  `references/troubleshooting.md`.
- Whether a test writes to the working directory, and checks in a
  teardown that nothing of the kind is present. mutineer runs every
  mutant's tests in the same working directory, so a leftover from one
  mutant can fail the teardown of every mutant that runs after it. See
  `references/troubleshooting.md`.

## 3. Get approval for the dependency, and pin it

Add `mutineer` to the project's development dependency group, pinned to
an exact version, with `require: false`: mutineer is a command-line
tool, not a library the project's own code loads.

Choose a version published more than 7 days ago. If a newer version
fixes a security issue or a correctness bug, consider it instead; read
the changelog to check. mutineer 1.0.1, for example, fixed a run that
passed its gate on a red unmutated suite, and fixed two concurrent runs
that could restore each other's mutated source. Pinning 1.0.0 would keep
both bugs.

A dependency manager with a minimum release age can refuse a version
published inside that window, even one the project's own rule already
approves. When that happens for an approved exception, override the
check for that one install; do not lower the age setting itself, and do
not change a version already recorded for another dependency.

mutineer has no runtime dependency of its own, so pinning it adds only
the one entry to the project's lockfile.

## 4. Wrap the run in a project task

Bring the setup into one task (a Rake task, or an equivalent), with these
settings:

- `RUBYOPT="-Itest -Ilib"` (`-Ispec -Ilib` for RSpec), set on the process
  environment. mutineer's own flags and its config file have no key for
  this. Two stages need this, and each needs a different half:
  coverage capture needs `test` on the load path, so
  `require "test_helper"` (or `spec_helper`) resolves; the per-mutant
  test run needs `lib` on the load path too, because mutineer puts `lib`
  on the load path for coverage capture but not for the mutant run
  itself. Dropping `-Ilib` turns every mutant into an `errored` verdict
  instead of a score. When the project's own `test_helper.rb` already
  unshifts `lib` onto `$LOAD_PATH`, `-Itest` alone is enough; add `-Ilib`
  only when the helper does not do this.
- One `--test` flag per test file. `--test` takes a single value; a
  second path placed after it is read as a source to mutate, not as a
  second test file.
- The test files that use `capture_subprocess_io`, left out of the run.
  They still run under the project's normal test task.
- `--strategy redefine`. See `references/troubleshooting.md` for why the
  default strategy can report a false kill.
- The output directory for `--output`, created before the run. mutineer
  does not create it.

## 5. Update the ignore file

Add mutineer's own cache and report directory to the project's ignore
file for version control. Add any directory a test writes to the working
directory and later checks for, from step 2.

## 6. Dry-run, then run one file

Run with `--dry-run` first, to see the candidate count without running
any test. Then run one source file with `--verbose`, and confirm the
verbose output shows no coverage-capture failure before you widen the
scope.

## 7. Run the whole scope

One project's measured run, on mutineer 1.0.2 and a 10-core machine,
mutated 706 mutants in about a minute.

## 8. Next

For how to read the result, see `references/results.md`. For how to
classify a surviving mutant, see `references/general/triage.md`.
