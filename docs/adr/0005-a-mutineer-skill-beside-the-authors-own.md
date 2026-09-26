# ADR 0005: A mutineer skill beside the author's own

## Status

Accepted

## Context

mutineer, a mutation testing tool for Ruby, publishes its own skill: a
`docs/skill.md` an agent can install with `npx skills add
davidteren/mutineer --skill mutineer`. That skill holds the CLI, the
agent loop, and the exit codes, and links to the author's own agent and
JSON schema guides.

That skill covers the CLI and the agent loop. A project's own setup is a
separate concern: the Ruby version floor, the survey a project needs
before a first run, the dependency pin and its exceptions, and the
pitfalls a first run meets (a missing load path entry, a `--test` flag
taken once, a captured-stdout test, a working-directory leftover, a
false kill from the default strategy). A first run on a real project met
several of these at once; `--verbose` and the exit code were the only
signals the CLI itself gave.

This repository's other skills hold a tool-neutral `references/` a new
skill reuses through a symlink (ADR 0001), and each tool's own skill
maps that tool's vocabulary onto the shared concepts.

## Decision

Add `skills/mutineer-practice/`, under a name distinct from `mutineer`,
so a reader can install both side by side. It names the author's skill
as the source of truth for the CLI, the agent loop, and the exit codes,
and does not copy any of that content. It holds only the setup steps,
the measured pitfalls, and the mapping onto this repository's shared
`references/`.

Each pitfall that traces to a bug in mutineer itself, rather than to a
project's own setup, says so, so a reader knows to look for a later
release that removes the workaround.

## Rejected alternatives

**Name the new skill `mutineer`.** Rejected: the author's own skill
installs under that same name (`npx skills add davidteren/mutineer
--skill mutineer`), so the two would collide in an agent's skill
directory, and a reader could install only one of them.

**Copy the author's skill's content into this repository.** Rejected: a
copy drifts from the original every time mutineer's own CLI, flags, or
exit codes change across a release; this repository would then need to
track mutineer's release notes just to keep a copy in step, work the
author's own skill already does for its own content.

## Consequences

A reader installs both skills to get full coverage: the author's
`mutineer` skill for the CLI and the agent loop, and
`mutineer-practice` for setup and troubleshooting. `mutineer-practice`
names the mutineer version its measurements were taken against; a later
mutineer release that fixes one of its pitfalls should drop that entry
here.
