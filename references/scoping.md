# Scope a mutation testing run

## Start small

Start with one file and the tests that cover it. A run at this scope
finishes in seconds and gives fast feedback while you triage survivors.
Widen the scope only after you have handled the survivors at the current
scope.

## Widen in steps

Move from one file to one module, then to the whole project. The run
time grows with the number of mutants and with the test time for each
mutant. Widen only after you triage the survivors at the smaller scope.

## Narrow the run

Most tools let you limit a run along three axes:

- the files to mutate (production code only)
- a line range inside one file
- the test files to execute

Narrowing along these axes keeps a run fast even inside a large project,
by testing a small slice of it at a time.

## Run only the changed code

An incremental run mutates only the code and tests that changed since the
last run, and reuses prior results for everything else. This keeps a run
fast in a large, long-lived project, once the first full run exists.

## Gate a pull request

See `operations.md`, in this directory, for how to gate a pull request on
mutation testing without requiring a person to read the full report.

## Do not chase a fixed score

Do not set a fixed target score, such as 100%, as a goal. Two reasons.
First, an equivalent mutant cannot be killed, so 100% is usually out of
reach regardless of test quality. Second, chasing a number pushes writers
toward tests that assert a mutant's exact replacement value instead of a
real property, which ties the suite to today's implementation. Track the
score's trend instead, and read the survivors themselves.
