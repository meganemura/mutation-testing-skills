---
name: stryker
description: Run mutation testing on JavaScript or TypeScript code with StrykerJS (`stryker run`, `stryker.config`). Use this skill to set up Stryker, read a mutation score, triage surviving mutants, and speed up a run.
---

# StrykerJS mutation testing

Follow this workflow. Each step links to a reference for the detail.

## 1. Pick a scope

Start with one file and its tests. A run at this scope finishes in
seconds. See `references/general/scoping.md`.

## 2. Choose and install a runner

Pick the test runner plugin that matches your test framework. Adding a
dependency needs the repository owner's approval; pin the exact version.
See `references/setup.md`.

## 3. Write a minimal config and run it

Write a `stryker.config.json` with the runner, the files to mutate, and
the test files. Add Stryker's working directories to your ignore file for
version control. See `references/setup.md`.

## 4. Read the result

Read the mutation score and the per-mutant status. See
`references/results.md` for Stryker's status names and score formulas,
and `references/general/concepts.md` for what each term means.

## 5. Triage the survivors

Classify each surviving mutant and act on it. See
`references/general/triage.md`.

## 6. If the run fails

See `references/troubleshooting.md`.

## 7. Widen the scope

Move to a module, then the whole project. Consider incremental mode and a
CI threshold. See `references/general/scoping.md`.
