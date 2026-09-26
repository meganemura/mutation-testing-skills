---
name: mutineer-practice
description: Set up and run mutineer, a mutation testing tool for Ruby projects on Minitest or RSpec (`mutineer run`). Use this skill to survey a project before a first run, avoid setup pitfalls, and triage surviving mutants. Use it beside mutineer's own `mutineer` skill, which holds the CLI, the agent loop, and the exit codes.
---

# mutineer, in practice

This skill supplements the skill mutineer's author publishes. That skill
(`npx skills add https://davidteren.github.io/mutineer/skill.md`, or
[its source](https://github.com/davidteren/mutineer/blob/v1.0.2/docs/skill.md))
is the source of truth for the CLI, the agent loop, and the exit codes.
This skill covers the setup steps, the pitfalls a first run meets, and
the tool-neutral concepts the general references hold.

Follow this workflow. Each step links to a reference for the detail.

## 1. Pick a scope

Start with one file and its tests. See `references/general/scoping.md`.

## 2. Install and configure

Follow `references/install.md`, from the top. It covers the Ruby
version, the project survey, the dependency pin, and how to wrap the
run in a project task.

## 3. Run one file first

Dry-run to see the candidate count, then run one file with `--verbose`.
See step 6 of `references/install.md`.

## 4. Read the result

Read the JSON report (`--format json`). See `references/results.md` for
the score formula and mutineer's status names, and
`references/general/concepts.md` for what each term means.

## 5. Triage the survivors

Classify each entry in `survivors[]`, in the order
`references/general/triage.md` gives. A survivor's `id` is a stable key;
use it in `--baseline` and in `.mutineer.yml`'s `ignore:` list.

## 6. If the run fails

See `references/troubleshooting.md`.

## 7. Widen the scope, and gate a pull request

Move to a module, then the whole project. For a pull request, mutineer's
own `--since` and `--baseline` flags scope a run to the changed lines
and gate on a regression; see the author's
[agentic-coding guide](https://github.com/davidteren/mutineer/blob/v1.0.2/docs/agentic-coding.md).
When a full run takes a few minutes, gate on a committed baseline of
accepted survivors instead; see `references/gate.md`. For the roles and
the timing around a gate, see `references/general/operations.md`.
