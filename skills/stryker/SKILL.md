---
name: stryker
description: Run mutation testing on JavaScript or TypeScript code with StrykerJS (`stryker run`, `stryker.config`). Use this skill to set up Stryker, read a mutation score, triage surviving mutants, and speed up a run.
---

# StrykerJS mutation testing

Follow this workflow. Each step links to a reference for the detail.

## 1. Pick a scope

Start with one file and its tests. A run at this scope finishes in
seconds. See `references/general/scoping.md`.

## 2. Install and configure

Follow `references/install.md`, from the top. It covers the project
survey, the runner choice, the dependency install, and the runner
configuration.

## 3. Write a minimal config and run it

Write a `stryker.config.json` with the runner, the files to mutate, and
the test files. Add Stryker's working directories to your ignore file for
version control, dry-run the setup, then run one file. See
`references/install.md`.

## 4. Read the result

Read `reports/mutation/agent.jsonl`, the `agent` reporter's output; see
`references/agent-output.md`. It lists survivors with a stable key, a
patch, and a rerun command. See `references/results.md` for Stryker's
status names and score formulas, and `references/general/concepts.md`
for what each term means.

## 5. Triage the survivors

Classify each `survivor` line in `agent.jsonl`, in the order
`references/general/triage.md` gives. After you add a test, confirm the
kill with that line's `rerun` command. When you judge a mutant
equivalent, disable it with `// Stryker disable next-line <operator>:
<reason>`.

## 6. If the run fails

See `references/troubleshooting.md`.

## 7. Widen the scope

Move to a module, then the whole project. Consider incremental mode and a
CI threshold. See `references/general/scoping.md`. For a PR, run
`npx stryker-agent-reporter gate --since <base ref>` instead: it fails
only on a changed line's own survivor, with no full-project baseline
needed. See `references/agent-output.md` and
`references/general/operations.md`.
