# ADR 0002: A dependency-free script digests the Stryker report

## Status

Accepted

## Context

Stryker's `mutation.json` (mutation-testing-report-schema 1.0) carries
every fact about a run, but not in a shape that leads directly to an
agent's next action: adding a test or reconsidering a survivor. Reading
it by hand, an agent still has to find the survivors among every other
status, cut the mutated text out of the source by column, work out which
tests covered it, and write its own command to rerun that one mutant.
None of that is in the report as a single field.

Ruby's mutineer, a separate mutation testing tool, already gives an
agent this shape through its `--format json` output: a `survivors[]`
list keyed by `subject`, `file`, `line`, `operator`, `id`, `token`, and
`diff`. An agent that reads both tools' output benefits from reading it
the same way each time.

## Decision

Add a post-processor: a dependency-free Node script,
`skills/stryker/scripts/digest.mjs`, that reads a Stryker report and
writes an agent-facing digest. Its `survivors[]` keys match mutineer's
list above; Stryker's report carries more than mutineer's, so `survivors[]`
adds `location`, `replacement`, `tests`, and `rerun`.

Each survivor gets a stable id: a hash of the file, the enclosing
subject, the mutated token, the operator, and the replacement, with no
line or column in it, so editing another part of the file leaves the id
unchanged. `--baseline` matches a previous run's digest to the current
one by this id, to show which survivors are new and which are fixed.

The script also builds a rerun command per survivor, from Stryker's own
`--mutate` range syntax, and a diff cut from the report's `location`.

## Rejected alternatives

**A separate npm package.** Rejected: this would add a dependency to
every project that installs this skill, for a script small enough to
carry in the skill itself. `references/` in this repository already
holds material with no install step; the script follows the same shape.

**A Stryker reporter plugin**, writing the digest during the run instead
of after it. Rejected: a plugin needs installing per project, the same
cost the first alternative has, and it cannot read a run that stopped
partway, because Stryker only calls a reporter's `onMutationTestReportReady`
when a run finishes. `reports/stryker-incremental.json` uses the same
report schema and is readable mid-run; a post-processor reads it the
same way it reads a finished report. A reporter plugin remains worth
building later, as a contribution to Stryker itself rather than as part
of this repository.

## Consequences

An agent reads one small, versioned JSON object instead of walking the
full report by hand. `digest.mjs` has no dependency to install or keep
current, and it runs against any report the schema version supports,
including an interrupted run's incremental file.

The script's `subject` field comes from a regular-expression scan of the
source, not a parser, so it can miss an unusual declaration shape.
`tests_without_kills` is only a candidate list, not a verified one, when
a run has not set `disableBail`, because Stryker records just the first
test that failed for a bailing run.

A change to Stryker's report schema, or to mutineer's `survivors[]`
shape, requires updating this script and `references/digest.md` by hand;
nothing here detects that drift automatically.
