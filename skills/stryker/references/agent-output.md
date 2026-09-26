# Read a Stryker run with the agent reporter

The `agent` reporter (package `stryker-agent-reporter`) writes
`reports/mutation/agent.jsonl`: one JSON object per line, so a survivor
or the summary is a `grep` or a `jq` filter away, with no need to parse
the whole file first. The full field list, the line order, and the
`convert` and `gate` commands are in the plugin's own docs:
https://github.com/meganemura/stryker-agent-reporter/blob/main/docs/output.md.
This page covers only what you need to act on a run.

Already have a saved `reports/mutation/mutation.json` from a run
configured without the `agent` reporter? Build the same JSONL from it:

```
npx stryker-agent-reporter convert [mutation.json] [--output <file>]
```

## Read it like this

```
grep '"file":"src/x.ts"' reports/mutation/agent.jsonl        # every line about one file
jq -c 'select(.kind=="survivor")' reports/mutation/agent.jsonl  # every survivor, one JSON object per line
tail -n 1 reports/mutation/agent.jsonl                        # the summary, once the run has one
tail -f reports/mutation/agent.partial.jsonl                   # follow a run still in progress
```

## Kinds

Each line carries a `kind`: `run` (first), then `survivor`, `unverified`,
`timeout`, `noCoverage`, `ignored`, or `invalid` (one per mutant an agent
can act on), then `testWithoutKills`, then `summary` (last). A `Killed` or
`Pending` mutant has no line of its own; the summary counts it instead.

## The fields you triage with

- `key`: a stable id for the mutant. Match it against a previous run's
  `agent.jsonl` by hand, or with `gate --baseline`, to tell a survivor
  that is new from one that was already there.
- `file`, `location`, `mutatorName`, `original`, `replacement`: where the
  mutant sits and what it changed.
- `tests` (final file only): a summary of the covering tests, so you know
  where to add a test.
- `rerun`, `rerunExact`: commands that rerun just this mutant, to confirm
  a kill after you add a test.
- `patch` (final file only): a `git apply --unidiff-zero`-ready diff of
  the mutation, for a quick look at what it changed.
- `sourceHash`: a hash of the file's source at run time. Compare it
  against the file's current content before trusting a `location` or a
  `rerunExact` command; an edit since the run shifts them.

## `unverified`

A `Survived` mutant whose covering tests did not complete: coverage says
a test reaches this mutant, but no result came back from it in this run.
Rerun rather than write a test for it; a new test would target a gap in
the measurement, not a gap in the suite.

## No `summary` line

A `summary` line appears only once a run finishes. Its absence means the
run has not finished yet: read `agent.partial.jsonl` instead, and check
back on the final file later.

## The PR gate

```
npx stryker-agent-reporter gate --since <base ref> --format github
```

Fails only on a survivor or an uncovered mutant on a line the PR itself
changed. An exit code of `3` means a mutant or a whole file could not be
measured this run; fix the measurement, then rerun, before you write a
test based on that line. `gate` reads the final file, not the partial
one: an input with no `summary` line is an unfinished run, and `gate`
exits `3` on it without reading further. See the plugin's own README for
the full exit-code table.
