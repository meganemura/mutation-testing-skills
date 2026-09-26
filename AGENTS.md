# AGENTS.md

Context for agents that work in this repository.

## What this is

A collection of Claude Code skills for mutation testing, one skill per
tool. The first skill covers StrykerJS, for JavaScript and TypeScript.

```
README.md            entry point for a human reader
LICENSE               MIT
AGENTS.md             this file
CLAUDE.md             symlink to AGENTS.md
docs/adr/              design records
references/            tool-neutral mutation testing concepts
  operations.md          run mutation testing across roles and time
skills/stryker/         the StrykerJS skill
  SKILL.md
  references/general -> ../../../references (symlink)
  references/install.md
  references/configuration.md
  references/results.md
  references/agent-output.md
  references/troubleshooting.md
```

## Where a rule lives

Tool-neutral material lives in `references/`: what a mutant is, how to
triage a survivor, how to scope a run. A tool-specific skill lives in
`skills/<tool>/`: its own `references/` holds setup, configuration,
reading results, and troubleshooting for that one tool.

Write a rule once, in the reference it belongs to. A skill's `SKILL.md`
links to the reference instead of repeating its content.

## Add a new skill

1. Create `skills/<tool>/`.
2. Inside it, add a relative symlink: `references/general` pointing to
   `../../../references`. See `docs/adr/0001-shared-references.md` for
   why the symlink must be relative and placed this way.
3. Write `skills/<tool>/SKILL.md`. Its frontmatter `name` field must match
   the directory name.
4. Write the tool-specific reference files the skill needs.

## Conventions

This repository is intended for public release. Write all committed text
in English, following ASD-STE100: one word for one meaning, active voice,
short sentences, no dropped articles.

Do not write a path specific to one machine, such as a personal home
directory. Write an installation example using a placeholder directory
name, such as `<repo>`.

This repository holds documents. Do not add a dependency.

When you change README.md, carry the same change into README.ja.md, its
Japanese translation, kept one sentence per line.
