# ADR 0003: Gate a pull request on the diff, not the whole project

## Status

Accepted

## Context

Mutation testing gives the strongest signal at the moment a change is
made, but a project's full run is too slow to sit in a pull request's
critical path (see `references/operations.md` section 9 for measured
run times). Two questions had no settled answer: what should block a
pull request, and how should a result move from one run to the next
without an agent or a reviewer re-deriving it from scratch each time.

A codebase written before mutation testing was adopted starts with
existing survivors nobody has triaged. Any rule keyed to the whole
project's score inherits that backlog on day one.

## Decision

Gate a pull request on the mutants that land on the diff's own changed
lines: fail the check until each is killed or ignored with a reason in
the code (`references/operations.md` sections 3 and 4). This condition
needs no comparison against a previous run, so it does not indict
existing code the change did not touch.

One case still needs a baseline: a change that removes or narrows an
existing test, weakening what the suite used to catch. Detect this by
rerunning the mutants an edited test used to kill and comparing against
that test's own previous result, kept in a cache tied to the branch that
produced it (`references/operations.md` section 5).

A measurement failure (zero tests run against a survivor, a timeout from
resource contention, a static timeout) is reported as a run failure, not
as a test failure, and does not block a pull request the way a genuine
survivor does (`references/operations.md` section 6).

A nightly full run feeds surviving mutants into whatever queue the team
already uses for incoming work, grouped by file or function rather than
by individual mutant, and updates an existing entry on a repeat rather
than creating a new one each night (`references/operations.md` section 7).

## Rejected alternatives

**Run the full project on every pull request.** Rejected: the measured
run times in `references/operations.md` section 9 make this too slow for
a check a person waits on.

**Gate on an absolute score threshold.** Rejected: a codebase with
existing survivors fails the gate immediately, on code the current
change did not touch, before any new work happens.

**Keep a list of ignored mutant ids instead of a source comment.**
Rejected: a mutant's id is tied to its line and its surrounding code. An
unrelated edit shifts the id, so the list drifts out of sync with the
mutants it names, and nothing forces someone to update it when that
happens.

**File one ticket per surviving mutant.** Rejected: a project can carry
thousands of mutants, so a per-mutant ticket queue grows unmanageably
large, and its membership churns on every run as the same underlying gap
gets a new id each time.

## Consequences

A pull request's gate stays fast and fair: it judges the change in front
of it, not the project's history. Adopting mutation testing on an
existing codebase does not require triaging every prior survivor before
the first gate can run.

The baseline comparison in section 5 relies on a stable per-mutant key.
That key has a known weak point, described in `references/operations.md`
under "The key design, and its weak point": when a line's exact text
repeats in a file, an edit elsewhere in the file can shift which repeat a
mutant's key points to, misreporting a shift as one mutant fixed and
another newly surviving. Where this matters, re-deriving a mutant's
position from a stored full result, rather than trusting the key alone,
avoids the false report.
