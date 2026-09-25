# mutation-testing-skills

Claude Code skills for mutation testing. Each skill covers one tool and
walks an agent through setup, running, reading results, and fixing
surviving mutants.

## What is here

- `skills/stryker/`: a skill for [StrykerJS](https://stryker-mutator.io/),
  for JavaScript and TypeScript.
- `references/`: tool-neutral mutation testing concepts, shared by every
  skill in this repository. See `docs/adr/0001-shared-references.md` for
  how each skill reaches this material.

## Install a skill

Claude Code loads a personal skill from a directory under
`~/.claude/skills/`. Clone this repository, then link the skill you want
into that directory:

```
ln -s <repo>/skills/stryker ~/.claude/skills/stryker
```

Replace `<repo>` with the path where you cloned this repository.

## Agent context

`AGENTS.md` (and its symlink, `CLAUDE.md`) describes this repository's
layout and conventions for an agent working inside it.
