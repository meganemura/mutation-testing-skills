# Mutation testing concepts

This page defines terms in tool-neutral language. A skill for one tool maps
these terms to that tool's status names.

## Mutant

A mutant is one copy of the code with one small change. A mutation operator
makes the change: it swaps an operator, flips a boolean, or removes a
statement. Each mutant tests one change at a time.

## Kill and survive

A test suite kills a mutant when a test fails against the mutated code but
passes against the original code. The failure proves the test can tell the
two versions apart.

A mutant survives when every test still passes against the mutated code. A
survivor means the test suite cannot tell the mutated behavior from the
correct behavior, for this one change.

## No coverage

A mutant has no coverage when no test executes the mutated line at all. The
suite never ran the code, so it never had a chance to kill the mutant.

## Timeout

A mutant times out when the test run does not finish in the allowed time.
Some mutations create an infinite loop or another form of runaway
execution. A tool can count a timeout as detected, because a test suite
that never returns has, in effect, noticed the change. Each skill states
how its tool counts a timeout.

## Invalid mutant

A mutant is invalid when it does not run at all: a compile error or a
runtime error stops it before any test can pass or fail. An invalid mutant
proves nothing about the test suite's strength. Each skill states whether
its tool excludes invalid mutants from the score.

## Ignored mutant

An ignored mutant is one a person excluded on purpose, with a stated reason.
Tools keep ignored mutants in the report, but the mutants do not count
toward the score.

## Equivalent mutant

An equivalent mutant changes the code's text but not its behavior for any
input. No test can kill it, because there is no observable difference to
detect. Finding one is a judgment call, not a tool output.

## Mutation score

The mutation score measures how well the test suite detects changes to
production code:

```
mutation score = detected / valid × 100
```

`detected` counts killed and timed-out mutants. `valid` counts every mutant
except invalid ones (ignored mutants are also excluded).

A second score measures detection only where the suite ran at all:

```
score for covered code = detected / covered × 100
```

`covered` counts every mutant a test executed, whether it survived or was
detected. This score isolates weak assertions from missing coverage: a
mutant with no coverage lowers the first score but not the second.

## Mutation score vs. line coverage

Line coverage measures whether a test executed a line. Mutation score
measures whether a test would notice if that line's behavior changed. A
line can have full coverage and still have surviving mutants, when the
tests execute the line but do not check the result it produces.
