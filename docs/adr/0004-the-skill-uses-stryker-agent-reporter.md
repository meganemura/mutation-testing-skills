# ADR 0004: The skill uses stryker-agent-reporter

## Status

Accepted

## Context

`skills/stryker/scripts/digest.mjs` and `stryker-agent-reporter`, a
Stryker reporter plugin published separately, computed the same
survivor id from the same report fields, in two codebases that had to be
kept in step by hand. ADR 0002 rejected a reporter plugin at the time, on
the ground that Stryker only calls a reporter's
`onMutationTestReportReady` once a run finishes, so a plugin could not
read a run that stopped partway the way a post-processor reading
`reports/stryker-incremental.json` could.

`stryker-agent-reporter` closes that gap: it writes a partial file,
`agent.partial.jsonl`, as each mutant finishes, so an agent can read a
run's progress before it ends. It is now published on npm, under a
license and a provenance chain that let a project depend on it the way it
already depends on `@stryker-mutator/core`.

A measurement on a 14,140-mutant report compared the two codebases'
key-building logic directly: 5,549 keys from a partial file matched the
same mutants' keys in the finished file, and the plugin's own `convert`
command reproduced a saved report's JSON Lines output byte for byte.

## Decision

The skill reads `stryker-agent-reporter`'s output and runs its commands,
in place of `digest.mjs`. `skills/stryker/scripts/digest.mjs`,
`scripts/digest.test.mjs`, `scripts/fixtures/`, and
`references/digest.md` are removed.

## Rejected alternatives

**Keep both `digest.mjs` and the plugin.** Rejected: two codebases
computing the same mutant key drift apart the moment one changes without
the other, the exact problem this decision closes.

**Keep `digest.mjs` in the skill, and have it call the plugin's `convert`
command instead of reading the report itself.** Rejected: this adds a
layer between the agent and the plugin's own output with nothing to show
for it; the skill can read `agent.jsonl` and run `convert` and `gate`
directly.

## Consequences

A project that installs this skill adds `stryker-agent-reporter` as a dev
dependency, pinned the same way as `@stryker-mutator/core` and its runner
(`references/install.md`). The skill needs the package published on npm;
it cannot fall back to a copy carried inside the skill the way
`digest.mjs` did.

The output's field names, its `run`/`survivor`/`summary` line shape, and
its exit codes are documented once, in the plugin's own `docs/output.md`
and `README.md`; `references/agent-output.md` in this skill points there
instead of restating the shape.
