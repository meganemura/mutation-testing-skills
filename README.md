# mutation-testing-skills

Claude Code skills for mutation testing. Each skill covers one tool and
walks an agent through setup, running, reading results, and fixing
surviving mutants.

## What is here

- `skills/stryker/`: a skill for [StrykerJS](https://stryker-mutator.io/),
  for JavaScript and TypeScript. It reads
  [stryker-agent-reporter](https://github.com/meganemura/stryker-agent-reporter)'s
  output, which turns a Stryker run into a survivor list an agent can act
  on.
- `skills/mutineer-practice/`: a skill for
  [mutineer](https://github.com/davidteren/mutineer), for Ruby on
  Minitest or RSpec. It covers setup and measured pitfalls; install it
  beside mutineer's own `mutineer` skill, which covers the CLI and the
  agent loop.
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

Install the mutineer skills, the author's own and this repository's, for
Claude Code, for all of your projects. The author's skill installs from its
URL: installed as `davidteren/mutineer`, it brings the whole docs site with it.

```
npx skills add https://davidteren.github.io/mutineer/skill.md -g -a claude-code
npx skills add meganemura/mutation-testing-skills --skill mutineer-practice -g -a claude-code
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
