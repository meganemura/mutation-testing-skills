# Troubleshoot StrykerJS

## TypeScript 7 has no JS API for tsconfig rewriting

Stryker 10.0.0 stops with this error when the project installs
TypeScript 7:

```
TypeError: ts.parseConfigFileTextToJson is not a function
```

Cause: Stryker's core imports the `typescript` package to rewrite the
`extends`, `references`, `include`, `exclude`, and `files` fields of the
sandbox's tsconfig. It calls `ts.parseConfigFileTextToJson` and
`ts.resolveProjectReferencePath`. TypeScript 7 does not have a JS API.

Upstream status: stryker-js issue #6111 tracks the fix. The maintainers
chose to parse the tsconfig with `jsonc-parser` and to stop importing
`typescript` in core. Pull request #6231 carries that change. When a
release includes it, remove the workaround below.

Workaround A, with no new dependency: use this workaround only when your
tsconfig has no `extends` and no `references` that point outside the
sandbox. In that case the rewrite changes nothing. Point `tsconfigFile`
at a file name that does not exist, and Stryker skips the rewrite.

```json
{
  "tsconfigFile_comment": "TypeScript 7 has no JS API. This tsconfig has no extends or references, so the rewrite has nothing to change.",
  "tsconfigFile": "stryker-skip-tsconfig-rewrite.json"
}
```

Workaround B, when the tsconfig points outside the sandbox: install
TypeScript 6 and TypeScript 7 side by side. The TypeScript team gives
this form in its TypeScript 7.0 announcement, for tools that need the
JS API:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

The package name `typescript` then holds TypeScript 6, so Stryker's
`import('typescript')` gets the JS API. The `tsc` command runs
TypeScript 7, and `tsc6` runs TypeScript 6. Pin exact versions in place
of the ranges, and get the owner's approval for the new dependency.

Before you use workaround B, search the project for a path into
`node_modules/typescript`, such as `node_modules/typescript/bin/tsc`.
Code that uses such a path gets TypeScript 6 after the change and gives
no warning.

For a pnpm project, users in issue #6110 report a narrower override. It
gives TypeScript 6 to Stryker alone:

```yaml
# pnpm-workspace.yaml
packageExtensions:
  "@stryker-mutator/core@<version>":
    dependencies:
      typescript: "npm:@typescript/typescript6@^6.0.2"
```

This guide has not tested either form of workaround B.

TypeScript 7 ships an unstable API under `typescript/unstable/*`. That
API does not replace the functions that core needs. Its
`parseConfigFile` returns the resolved options and file names, and core
must rewrite the original text of `extends` and `references`.

The type checker is a separate case. `@stryker-mutator/typescript-checker`
10.0.0 can check mutants with TypeScript 7 (stryker-js pull request
#6099). Turn it on with this option:

```json
{
  "checkers": ["typescript"],
  "typescriptChecker": { "experimentalNativePreview": true }
}
```

This mode expects the side-by-side layout of workaround B:

- The checker loads TypeScript 7 from `@typescript/native/unstable/sync`.
  Install TypeScript 7 under the alias `@typescript/native`. The load
  error message names a `typescript7` alias, but the code and the option
  schema use `@typescript/native`.
- The checker still imports `typescript` to parse the tsconfig, so the
  package name `typescript` must hold TypeScript 6.

In this mode the checker does not support project references, and it
checks mutants one at a time. Mutant grouping is tracked in issue #6112.

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
