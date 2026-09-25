# Troubleshoot StrykerJS

## TypeScript 7 has no JS API for tsconfig rewriting

Confirmed by running Stryker against TypeScript 7 (native): Stryker stops
with `TypeError: ts.parseConfigFileTextToJson is not a function`.

Cause: Stryker's core imports the `typescript` package to rewrite the
`extends`, `references`, `include`, `exclude`, and `files` fields of the
sandbox's tsconfig. TypeScript 7's native compiler does not expose that
JS API.

Workaround: if your tsconfig has no `extends` and no `references`
pointing outside the sandbox, the rewrite would not change anything
either way. Point `tsconfigFile` at a file name that does not exist, and
Stryker skips the rewrite.

If your tsconfig does point outside the sandbox, this workaround does
not apply. Two options, neither confirmed by this pilot: run with
`inPlace`, or install a TypeScript 6.x copy alongside TypeScript 7 for
Stryker to use. The `typescript-checker` plugin may depend on the same
missing API; this is also unconfirmed.

## Build command fails

Run the `buildCommand` yourself first, outside Stryker, to confirm it
works on its own. If it does, run it again inside a sandbox directory
(`.stryker-tmp/sandbox-*`) after a Stryker run, since the sandbox lacks
your `node_modules` and needs the full path to a compiler binary.

## The initial test run fails with a type error

Stryker inserts a mutant, which can introduce a type error unrelated to
the test's own logic. Stryker adds `// @ts-nocheck` to suppress this, but
only inside `lib`, `src`, and `test` by default. If your code lives
elsewhere, set `disableTypeChecks` to a glob pattern that covers it.

## Windows: Jest and a hidden temp directory

Jest does not match a hidden folder on Windows, and Stryker's default
`tempDirName`, `.stryker-tmp`, is hidden by its leading dot. This can show
as "No tests found" or as every mutant reporting Survived with 0%
score. Set `tempDirName` to a name without a leading dot, or run with
`inPlace`.

## Out of memory

A `Committing semi space failed` crash usually means too many worker
processes for the machine's memory. Lower `concurrency`.

## pnpm: a plugin is not found

Stryker scans `node_modules` to auto-load a plugin such as
`@stryker-mutator/typescript-checker`. pnpm's directory layout defeats
this scan. List the plugins explicitly in the `plugins` config option.

## All mutants survive, but you expected kills

First check whether the mutated code actually runs under your test
command, as described in `references/general/triage.md`'s first step.
Two known causes:

- `module-alias`: Stryker's sandbox does not resolve alias imports the
  way your project root does. Either mark `node_modules` as part of the
  sandbox and disable `symlinkNodeModules`, or run with `inPlace`.
- A test suite that calls the code under test indirectly, for example
  through an HTTP request rather than a direct import. Vitest's `related`
  filter can miss the file in this case; disable `vitest.related`, or
  import the source file directly from the test file.

## Score is 0% across the board

Confirm first that the mutated code is the code your tests actually run.
A common cause: the tests import a built copy, such as from `dist/`,
while Stryker mutates the source under `src/`.
