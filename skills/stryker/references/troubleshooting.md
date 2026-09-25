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
works on its own, then run it again inside a sandbox directory. See
Stryker's troubleshooting docs, section "Build command fails":
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/troubleshooting.md`.

## The initial test run fails with a type error

Stryker inserts a mutant, which can introduce a type error unrelated to
the test's own logic. See Stryker's troubleshooting docs, section "The
initial test run fails with a type error":
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/troubleshooting.md`.

## `disableTypeChecks: true` touches files you did not mean to mutate

The default value, `true`, adds `// @ts-nocheck` to every TypeScript file
in the sandbox, not only the files under `mutate`. This can remove an
existing `// @ts-expect-error` or `// @ts-check` directive on a file the
mutation run never touches. A test that compares file contents, such as
one that checks a generated file is up to date, then sees that file as
changed and fails during the dry run, before any mutant runs.

If your tests run through Node's own type stripping rather than a
compiler step, no test needs type checking at run time in the first
place. Set `disableTypeChecks` to the same glob as `mutate`, so it
touches only the files under test.

The core schema's own `disableTypeChecks` description says the default
touches only `lib`, `src`, and `test`. Stryker's prose configuration docs
say the default touches every TypeScript-like file. A measured run
matched the prose docs, not the schema's own description: files outside
`lib`, `src`, and `test` also received `// @ts-nocheck`.

## A test that checks a compiler's output fails only under mutation

A test that runs `tsc` or reads its result checks the inferred types of
the real source. Instrumented source carries mutation-testing code and,
depending on `disableTypeChecks`, `// @ts-nocheck`; its inferred types
differ from the real source for reasons that have nothing to do with any
mutant. Such a test fails in the dry run even before Stryker introduces a
mutant.

Exclude that test from the runner's test files and leave it to your
normal test command instead.

To confirm the cause before you exclude a test: run Stryker once with
`cleanTempDir: false` and a `tempDirName` set apart from your usual one,
so the sandbox survives the run. Then run the failing test directly
inside that sandbox directory and read its output.

## Two Stryker runs in one repository can delete each other's sandbox

Stryker's configuration docs say that a successful run deletes its
`tempDirName` directory in full. Suppose two Stryker runs in the same
repository share the default `tempDirName`. Then the first run to finish
can delete the sandbox of the other run while it is still in progress.
Give each run its own `tempDirName`. This guide took this precaution and
did not test the failure itself.

## Windows: Jest and a hidden temp directory

Jest does not match a hidden folder on Windows. See Stryker's
troubleshooting docs, section "Windows":
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/troubleshooting.md`.

## Out of memory

A `Committing semi space failed` crash usually means too many worker
processes for the machine's memory. See Stryker's troubleshooting docs,
section "Out of memory":
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/troubleshooting.md`.

## pnpm: a plugin is not found

pnpm's directory layout can defeat Stryker's `node_modules` plugin scan.
See Stryker's troubleshooting docs, section "pnpm":
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/troubleshooting.md`.

## All mutants survive, but you expected kills

First check whether the mutated code actually runs under your test
command, as described in `references/general/triage.md`'s first step.
Two known causes, `module-alias` and Vitest's `related` filter missing an
indirect test, are in Stryker's troubleshooting docs:
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/troubleshooting.md`.

## Score is 0% across the board

Confirm first that the mutated code is the code your tests actually run.
A common cause: the tests import a built copy, such as from `dist/`,
while Stryker mutates the source under `src/`.

## Vitest: code that depends on Node's module semantics fails under Vite's module runner

Symptom: a test that passes under plain Node fails under Vitest. Three
measured cases: a module namespace's export order follows declaration
order, not ECMA-262's sorted order; a missing-import error
(`ERR_MODULE_NOT_FOUND`) carries no `url`; and a module that once failed
to load stays failed, even after you add the file it was missing.

Fix: set `test.experimental.viteModuleRunner: false` in the Vitest
config. Under this setting, `vi.spyOn`, Hegel, `node:sqlite`, and
`import.meta.dirname` all worked in testing. Whether `vi.mock` works
under this setting was not tested; Vitest's own type definitions say
that, with the module runner off, `vi.mock` falls back to a module
loader.

## Vitest 5: every mutant with per-test coverage survives, and no test runs

Symptom: most survivors have a non-empty `coveredBy`, and `testsCompleted`
is `0`. digest.mjs reports these under `unverified[]`, not `survivors[]`.

Cause: Vitest 5 matches `testNamePattern` against a suite's name joined to
a test's name with ` > `. Stryker's vitest-runner 10.0.0 joins them with a
plain space and builds a regular expression from that, so a test inside a
`describe` block never matches, and the runner selects no test for the
mutant (stryker-js issue #6210; fix pull requests #6214 and #6220, not
released as of this writing).

Confirm: `npx vitest run <file> -t "<describe> <test>"` selects 0 tests;
`npx vitest run <file> -t "<describe> > <test>"` selects 1.

Fix: until the fix releases, pin Vitest 4. The published vitest-runner
10.0.0 names `4.1.10` in its `devDependencies`; `4.1.11`, a later patch
of the same line, also worked. See "runner plugin and test framework
version" in `install.md`. Measured on one file: `killed=58 survived=105`
under Vitest 5, `killed=145 survived=18` under Vitest `4.1.11`.

## A mutation run leaves temporary directories behind, and a later test fails on them

Symptom: after a mutation run, a plain test run fails while it inspects
the contents of a shared temporary directory.

Cause: when a mutant stops a test partway, the test's own cleanup does
not run, so anything it wrote under the shared temporary directory stays
behind. Measured: 586 leftover entries after one full run.

Fix: make each test inspect only what it created itself. One way: point
`TMPDIR` at a directory private to the test run, for the run's duration.
Node's `os.tmpdir()` reads `TMPDIR` on every call, so this takes effect
without a restart. Anything left behind from before this fix sits in the
OS's own temporary directory, findable by its name prefix.

## A fixture that waits for its parent's kill can be left running forever

Symptom: during a mutation run, the count of test child processes climbs,
the whole run slows, and timeouts increase. One measured run left 145
such processes after 20 minutes.

Cause: when a runner bails on the first failure, or kills a test process
on timeout, that test's own cleanup (its after hook) does not run. A
child process that waits for its parent to kill it then keeps running.

Fix: give the child process a wait limit of its own, so it exits on its
own once that limit passes. Check for leftover processes with
`pgrep -fl .stryker-tmp`.
