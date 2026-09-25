# Set up StrykerJS

## Install

Run `npm init stryker@latest` in the project root. It installs Stryker and
asks a series of questions to write a starting config.

Or install by hand: add `@stryker-mutator/core` and one test runner plugin
as dev dependencies, each pinned to an exact version. Adding a dependency
needs the repository owner's approval.

## Choose a test runner

| Runner | perTest coverage | Incremental test reporting |
| --- | --- | --- |
| Jest | yes | full |
| Vitest | yes, always on | full |
| Mocha | yes | tests per file, no location |
| Jasmine | yes | test names only |
| Karma | yes | test names only |
| CucumberJS | yes | full |
| Tap | yes, one test per file | tests per file, no location |
| Command | no | nothing |

"perTest coverage" means Stryker can run only the tests that cover one
mutant, instead of the whole suite, for that mutant. The command runner
cannot report this, because Stryker only sees an exit code. The tap
runner reports coverage per test file, because it treats one file as one
test; it cannot see inside a file to a single test case.

"Incremental test reporting" describes how well incremental mode can tell
which tests changed between runs. "Full" gives Stryker the exact test
locations. "Tests per file, no location" makes Stryker assume every test
in a changed file changed. "Test names only" and "nothing" narrow this
further; see `references/general/scoping.md` for what incremental mode
buys you.

## node:test with the tap runner

For a project using Node's built-in test runner (`node:test`), use
`@stryker-mutator/tap-runner`. This runner does not depend on
`node-tap`. It runs each test file with `node`, directly, and reads the
file's TAP output with a TAP parser.

Its default `nodeArgs` is:

```
["--test-reporter=tap", "-r", "{{hookFile}}", "{{testFile}}"]
```

This is the default since Stryker 9.0.

Limitations: one test file is one test, run in its own process; a static
mutant (one whose code runs only while the file loads, not inside a test)
cannot be measured for coverage.

The default `tap.testFiles` matches every file under `test/`. If that
directory holds a helper or a fixture file that is not itself a test,
narrow the glob, for example to `test/*.test.ts`.

To exclude one test file from an otherwise broad glob, a leading `!` on a
separate glob entry does not work with this runner (confirmed with
Stryker 10.0.0). Write the exclusion as one extglob instead:
`test/!(stale).test.ts` runs every `*.test.ts` file in `test/` except
`stale.test.ts`.

## TypeScript source files

When you run `.ts` test files directly with Node's own type stripping, no
extra `nodeArgs` are needed; this was confirmed against Node 26.7.0. If
you instead use a just-in-time transpiler such as `tsx`, add
`"nodeArgs": ["--import", "tsx"]` to the `tap` config. When run speed
matters more than a simple config, compile first with a `buildCommand`
and point `testFiles` at the compiled output.

## A minimal configuration

```json
{
  "testRunner": "tap",
  "tap": {
    "testFiles": ["test/my-module.test.ts"]
  },
  "mutate": ["src/my-module.ts"],
  "coverageAnalysis": "perTest",
  "reporters": ["clear-text", "progress", "html", "json"],
  "ignorePatterns": ["dist"]
}
```

Adjust `tap.testFiles` and `mutate` to the files you picked in
`references/general/scoping.md`.

## Artifacts

Stryker writes two kinds of output: a sandbox directory
(`tempDirName`, `.stryker-tmp` by default) where it copies your code to
mutate it, and a reports directory (`reports/`, holding the html and json
reports). Add both to your version control ignore file.

`tempDirName` is deleted in full after a successful run. Do not point it
at a directory that holds anything you want to keep.

## Trim the sandbox copy

Use `ignorePatterns` to keep large directories that your tests do not
need out of the copy Stryker makes for the sandbox. This speeds up
Stryker's startup on a large repository. Stryker always leaves out
`node_modules`, `.git`, the `tempDirName` directory, and its own report
files, so you do not need to list them.
