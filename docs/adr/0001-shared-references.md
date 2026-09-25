# ADR 0001: Share tool-neutral references through a symlink

## Status

Accepted

## Context

This repository holds one skill per mutation testing tool. Each skill needs
the same tool-neutral material: what a mutant is, how to triage a survivor,
how to scope a run. Writing this material once, and reusing it, avoids
divergent copies.

A skill is enabled by a symlink from `~/.claude/skills/<name>` to this
repository's `skills/<name>` directory. An agent reads a skill's files
through that installed path. Suppose `SKILL.md` links to
`../../references/concepts.md`. The operating system resolves each `..`
against the real directory, so a shell command such as `cat` reaches this
repository's `references/`. A tool that normalizes the path as text
removes each `..` before the operating system sees the path. Node's
`path.resolve` does this, and so does the file-read tool of Claude Code.
Both turn the path into `~/.claude/references/concepts.md`, which does
not exist.

## Decision

Each skill directory holds a relative symlink, `references/general`,
that points to `../../../references` (relative to the skill's own
directory inside this repository). The path
`~/.claude/skills/<name>/references/general/concepts.md` has no `..` in
it, so text normalization leaves it unchanged. The operating system then
follows both symlinks and reaches this repository's
`references/concepts.md`. A link inside a skill must not use `..` to
climb out of the skill directory.

`references/` uses no tool-specific vocabulary: no tool's status names, no
tool's flag names. Each skill's own `references/` maps the tool's
vocabulary onto the shared concepts. For example, a skill states which of
its tool's status names count as "detected" in the shared score formula.

## Consequences

A new skill, such as one for Ruby's mutineer, reuses `references/`
without copying it: the skill's directory gets the same
`references/general` symlink, and its own `references/` adds only the
tool-specific mapping.

A reader who opens a skill through the installed symlink can still follow
every link inside it, because the chain of symlinks resolves to files
inside this repository.

## Rejected alternatives

**Copy the tool-neutral material into each skill.** Rejected: the concepts
and the triage steps do not change per tool, so a copy diverges over time
as each skill's writer edits their copy without updating the others.

**Move the tool-neutral material into its own skill, and have each
tool's skill reference it by name.** Rejected: this makes the tool's skill
depend on a second skill being installed alongside it. A reader who
installs only `skills/stryker` should not need to also discover and
install a second skill just to read the concepts it depends on.
