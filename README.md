# mutation-testing-skills

Claude Code skills for mutation testing. Each skill covers one tool and
walks an agent through setup, running, reading results, and fixing
surviving mutants.

## What is here

- `skills/stryker/`: a skill for [StrykerJS](https://stryker-mutator.io/),
  for JavaScript and TypeScript. It includes `scripts/digest.mjs`, which
  turns a Stryker report into a survivor list an agent can act on.
- `references/`: tool-neutral mutation testing concepts, shared by every
  skill in this repository, including how to gate a pull request on a
  change's own diff (`references/operations.md`). See
  `docs/adr/0001-shared-references.md` for how each skill reaches this
  material.

## Install a skill

Install a skill with the [`skills`](https://github.com/vercel-labs/skills)
CLI. This command installs the StrykerJS skill for Claude Code, for all
of your projects:

```
npx skills add meganemura/mutation-testing-skills --skill stryker -g -a claude-code
```

To see the skills in this repository, run
`npx skills add meganemura/mutation-testing-skills --list`. To install
into the current project instead, leave out `-g`.

The CLI copies the skill's `references/general` link as a directory, so
the installed skill carries the shared references with it.

## Agent context

`AGENTS.md` (and its symlink, `CLAUDE.md`) describes this repository's
layout and conventions for an agent working inside it.

---

[Japanese](README.ja.md)
