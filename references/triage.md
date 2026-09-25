# Triage a surviving mutant

Classify each survivor in this order. Stop at the first class that fits.

## 1. Configuration error

Check this first when the score is 0%, or when the kill count is 0. Before
you write a single test, confirm the mutated code actually runs under the
test command. A common cause: the tests import a built copy of the code
(for example, from a `dist/` directory) instead of the source the tool
mutated.

## 2. No test

The mutant has no coverage: no test executes the mutated line. Write a test
that exercises the line, then rerun.

## 3. Weak assertion

A test executes the mutated line but does not check the result closely
enough to notice the change. Strengthen the assertion.

When you add or strengthen a test to kill a mutant, assert a property you
can state as a requirement, not the mutant's exact replacement value. A
test that pins one arbitrary implementation detail breaks on the next
harmless refactor; a test that states a real property survives it.

## 4. Missing boundary case

The mutant changes a comparison at a boundary, such as `>` to `>=`. The
suite has no test at that exact boundary value. Add one.

## 5. Equivalent mutant

The mutated code behaves the same as the original for every input. No test
can kill it. Confirm this by reasoning about the change, not by trying
more tests. Disable the mutant with a stated reason; do not leave it as an
unexplained survivor.

## 6. Not worth killing

The mutant is valid and not equivalent, but killing it buys nothing: for
example, it touches generated code, or a code path the project has
decided not to test. Disable it with a stated reason, the same as an
equivalent mutant.

## Cross-cutting notes

A timeout usually comes from an infinite loop that the mutation created.
A timeout can also come from a time limit that is too short for a slow or
busy machine. When many mutants time out, raise the time limit and rerun
before you count them as detected.

A parallel test run can produce a false kill when workers share a
resource, such as a port or a file. A test then fails because another
worker holds the resource, and the mutant has no part in the failure.
When a kill result surprises you, rerun with concurrency set to 1 before
you trust it.
