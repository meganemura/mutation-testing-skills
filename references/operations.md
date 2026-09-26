# Run mutation testing across roles and time

This reference describes how mutation testing fits into a team's daily
work: who runs it, when, and what result crosses from one role to the
next. It names no tool and no tool's option. A tool's own reference maps
these ideas onto its flags and file names.

## 1. The unit of action is a change

A team's mutation score is a lagging indicator. It moves after a change
lands, and by itself it does not tell a person which line to fix. Run
mutation testing where a change is made, and act on the result there,
much as a linter or a type checker acts on a change in place. Treat the
project-wide score as a trend to watch, not a task to work from.

## 2. Each role reads a different slice

| Role | Scope | Action |
| --- | --- | --- |
| An agent making a change | The lines it just wrote | Kill each surviving mutant, or mark it ignored with a reason |
| A pull request check | The lines a change adds or edits | Fail the check, and annotate the lines, until every mutant there is killed or ignored with a reason |
| A reviewer | The diff | Read an ignored-mutant comment as part of the code under review |
| A nightly run | The whole project | Surface a drift outside the current change, and feed a queue for later work |

## 3. The pull request gate: judge the diff, not a fixed score

Gate a pull request on one condition: every mutant that lands on a
changed line is either killed or ignored with a reason. This condition
comes from the change's own diff, so it needs no result from a previous
run. It also does not indict code the change did not touch.

Do not gate on an absolute score threshold (for example, failing a build
when the score drops below a fixed percentage). A codebase written before
mutation testing was in place usually starts under most thresholds, so
the gate fails on day one, on code nobody touched this week.

## 4. A judgment about a mutant belongs in the code

When a mutant is equivalent, or killing it is not worth the cost, write
that judgment as a comment next to the code, with a reason. The comment
travels with the code through a rename, a move, and a review; a reviewer
reads it as part of the change.

Do not keep a separate list of ignored mutant ids. Line numbers and
surrounding code shift as the file changes, so an id-based list drifts
out of sync with the source it was meant to describe.

## 5. One place still needs a baseline: a change to the tests

A gate built on the current diff (section 3) catches a weak new test,
because an added test's own lines carry mutants to kill. It does not
catch the opposite case: a change that removes or narrows an *existing*
test, weakening what the test suite already caught. That case needs a
comparison against a previous run.

To check it, rerun the mutants an edited test used to kill, and compare
against that test's previous result. Keep the previous run's result in a
place that persists across pull requests, such as a cache tied to the
main branch's own runs (not committed to the repository, since it is a
run artifact, not a decision).

Two ways to line up a mutant across the two runs. Re-deriving the mutant's
position from the diff between the two source versions is exact. Matching
by a stable key computed from each mutant is simpler, but drifts when a
line's exact text repeats elsewhere in the same file (see the key design
below).

## 6. A measurement failure is not a test failure

Three situations look like a weak test suite but are not:

- A surviving mutant with zero tests run against it. The suite never
  exercised that code path for this mutant; no test failed to catch it.
- A mutant that times out because it shares a machine with an unrelated
  concurrent run, not because the mutated code loops forever.
- A mutant whose timeout comes from a static, load-independent check
  rather than from running the mutated code at all.

Report each of these as a run's own failure, separate from a survived
mutant a test should have caught. In a pull request check, fix the run
(fewer parallel jobs, no other heavy job sharing the machine) rather than
asking a person to explain a test that never had a chance to run.

## 7. A nightly run feeds a queue, not a flood

A nightly full run finds drift a diff-scoped gate cannot see: a survivor
introduced by a change to unrelated code, an interaction between two
files. Feed its output into wherever a team already tracks incoming
work: an issue tracker, an agent's task queue, or nowhere at all if the
team is not ready to act on it yet.

Two properties keep this feed usable over time. First, a repeat item
from the same file or function updates the same tracked entry instead of
creating a new one on every run; a stable key across runs is what makes
this possible (see the key design below, including its weak point).
Second, group by file or function, not by individual mutant; a project
can carry thousands of mutants, and a queue with one entry per mutant
drowns any team that reads it. A test that kills no mutant at all is a
signal to review, not a signal to delete outright: some such tests guard
types or code outside the mutated source.

## 8. What to commit, and what to share only at runtime

| Artifact | Commit it? | Where it lives instead |
| --- | --- | --- |
| A full project report | No | A pull request check's own artifact storage, or a hosted report a person can browse |
| Incremental run state | No | A cache tied to the branch that produced it; it is large and changes on every run |
| A judgment to ignore a mutant | Yes | A comment in the source, next to the mutant (section 4) |
| A list of surviving mutants' keys | Can, if small | Prefer re-deriving position from a stored full result (section 5) when position must be exact; a key list alone has the weak point below |

## 9. What each scope costs in time

Three scopes, from fastest to slowest:

- **Local, one file**: seconds to a few minutes. Suited to the moment a
  change is being written.
- **A pull request's changed files and tests**: a few minutes to
  perhaps fifteen. Suited to a check that gates merging.
- **Nightly, the whole project**: hours. Suited to an overnight job with
  no one waiting on it.

One project's measurements: a full run of 14,140 mutants took about 2.5
hours with a per-test runner, and an estimated 9 to 10 hours with a
per-file runner. A single file of 32 mutants took 6 seconds.

## The key design, and its weak point

Sections 5, 7, and 8 above depend on a stable key: an identifier for one
mutant that survives a small edit elsewhere in the file, so a later run
can recognize "the same mutant" without relying on its line number.

Build the key from a SHA-1 hash, truncated to the first 12 hex digits, of
these fields joined by a NUL byte:

1. the file path
2. the full text of the line the mutant sits on, each end trimmed of
   whitespace, joined by a newline when the mutant spans several lines
3. the original code the mutant replaces
4. the operator name
5. the replacement code
6. a column-order index, counting from 0, distinguishing mutants that
   share fields 1 through 5 and sit on the same line
7. an occurrence-order index, counting from 0, distinguishing mutants
   that share fields 1 through 6 *and* whose line text (field 2) repeats
   elsewhere in the file

Leave the raw line number and column number out of the key. A change of
indentation, or an edit elsewhere in the file, shifts both without
changing the mutant itself; including them would break the "survives a
small edit" property the key exists for.

This key has one known weak point: when a line's exact text occurs more
than once in a file, field 7's occurrence order can shift if an edit adds
or removes an earlier copy of that line, even though the mutant itself
did not move. A key list alone (section 8) can misreport a shifted
occurrence as one mutant fixed and a different one newly surviving. When
the shift matters, prefer re-deriving position from a stored full result
(section 5) over trusting the key list alone.
