# Install and configure StrykerJS

Follow these steps in order. Each step names what to do and the pitfall
you meet there. For the full explanation of a pitfall, follow the link to
`troubleshooting.md`.

## Where the official information is

An npm package does not carry prose docs. `@stryker-mutator/core`'s own
`README.md` only links to stryker-mutator.io.

The option schema does ship in the package. Core's options are in
`node_modules/@stryker-mutator/core/schema/stryker-schema.json`; each of
its 53 options carries a `description`. A runner plugin has its own
schema file, at
`node_modules/@stryker-mutator/<runner-package>/dist/schema/<runner-package>-options.json`
(confirmed for `vitest-runner`). Match the schema file to the version you
installed.

Read one option's description:

```
jq -r '.properties.<option>.description' node_modules/@stryker-mutator/core/schema/stryker-schema.json
```

List every option name:

```
jq -r '.properties | keys[]' node_modules/@stryker-mutator/core/schema/stryker-schema.json
```

The schema and the prose docs disagree in at least one place; see
"disableTypeChecks" in `troubleshooting.md`.

For prose, read Stryker's docs from its GitHub repository, at the tag
that matches your installed version:
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/<page>.md`.
Read the version first:

```
node -p "require('@stryker-mutator/core/package.json').version"
```

Page names include `getting-started`, `configuration`, `config-file`,
`incremental`, `disable-mutants`, `parallel-workers`, `troubleshooting`,
`typescript-checker`, `tap-runner`, `vitest-runner`, `jest-runner`, and
`mocha-runner`.

## 1. Survey the project first

Before you touch anything, check these points:

- The test framework in use (`node:test`, Vitest, Mocha, Jest, and so
  on), and whether tests run as `.ts` files directly, through Node's own
  type stripping.
- The installed TypeScript version. Version 7 stops Stryker's core from
  starting; see "TypeScript 7 has no JS API for tsconfig rewriting" in
  `troubleshooting.md`. Check whether `tsconfig.json` has an `extends` or
  a `references` entry that points outside the project.
- Whether a test checks a compiler's output, or compares file contents
  against a generated file; see "A test that checks a compiler's output
  fails only under mutation" and "`disableTypeChecks: true` touches files
  you did not mean to mutate" in `troubleshooting.md`.
- Whether a test starts a child process and waits for its parent to kill
  it. This kind of fixture can be left running after an interrupted run;
  see "A fixture that waits for its parent's kill can be left running
  forever" in `troubleshooting.md`.
- Whether a non-test helper or fixture file, with a `.ts` extension, sits
  under the test directory.
- Whether tests share a resource, such as a fixed port or file name. A
  parallel worker can then report a false kill; see
  `references/general/triage.md`.
- Whether a test inspects the contents of a shared temporary directory.
  See "A mutation run leaves temporary directories behind, and a later
  test fails on them" in `troubleshooting.md`.

## 2. Choose a runner

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

This table is not an option description, so it is not in the schema. For
each runner's own configuration options, read the schema file under
`node_modules/@stryker-mutator/<runner>/dist/schema/`, and the runner's
own docs page (`tap-runner`, `vitest-runner`, `jest-runner`, or
`mocha-runner`).

Two points from measurement, to help you choose:

- The tap runner reports coverage per file, so one mutant runs a whole
  test file in its own process. On 28 files and 14,140 mutants, a dry
  run took 33 seconds, and the full run's estimate was about 9 to 10
  hours.
- If you need coverage per test, consider moving your tests to Vitest or
  Mocha. Moving about 80 files to Vitest was a mechanical change: update
  imports, replace `before`/`after` with `beforeAll`/`afterAll`, replace
  `t.after` with `onTestFinished`, replace `t.mock.method` with
  `vi.spyOn`, and replace a skip option with `test.skip` or
  `test.skipIf`. `node:assert` needs no change.

## 3. Get approval for the dependencies, and pin them

- Add `@stryker-mutator/core` and one runner plugin as dev dependencies,
  each pinned to an exact version:
  `npm install --save-dev --save-exact <package>@<version>`. Adding a
  dependency needs the repository owner's approval.
- Choose a version published more than 7 days ago. If a newer version
  exists, read its release notes to check whether it fixes a security
  issue; if it does, consider the newer version instead. Read the
  publish date with `npm view <package> time --json`.
- Check the runner plugin's peer dependency (`vitest` for the vitest
  runner, `vite` for vitest itself). npm installs a peer dependency on
  its own.
- Compare `npm audit` before and after the install, and report any new
  finding. One measured example: `@stryker-mutator/core` pulled in two
  moderate findings through `typed-rest-client`'s dependency on `qs`.
- `@stryker-mutator/core` alone carries about 166 transitive dependencies
  (measured on Stryker 10.0.0).
- Check which version of the test framework the runner plugin was tested
  against; a peer dependency range that allows a newer major does not
  mean that version works. Read it from the runner plugin's own installed
  `package.json`, under `devDependencies`: `jq -r
  '.devDependencies.vitest' node_modules/@stryker-mutator/vitest-runner/package.json`
  (example: the published vitest-runner 10.0.0 names `vitest` `4.1.10`).
  See "Vitest 5: every mutant with per-test coverage survives, and no
  test runs" in `troubleshooting.md`.

## 4. Configure the runner

### Tap runner (`node:test`)

Read `nodeArgs`'s default and `tap.testFiles`'s default from the
runner's own schema file; the `tap-runner` docs page explains each in
prose.

To exclude one test file from an otherwise broad glob, a leading `!` on
a separate glob entry does not work with this runner (confirmed with
Stryker 10.0.0). Write the exclusion as one extglob instead:
`test/!(stale).test.ts` runs every `*.test.ts` file in `test/` except
`stale.test.ts`.

### Vitest runner

Read the `vitest` schema's `related` option for its default and
description:
`jq -r '.properties.vitest.properties.related' node_modules/@stryker-mutator/vitest-runner/dist/schema/vitest-runner-options.json`.
Stryker's vitest-runner docs also list the vitest settings Stryker forces
for a correct run.

Related mode selects tests by following an import graph from the
mutated file. A test that reaches the code under test indirectly, such
as through a child process or a separate runtime, is not reached by that
graph. Stryker then does not select it, and the code it exercises is not
measured. To pick a fixed set of tests for a mutation run, write a
separate Vitest config file, for example `vitest.mutation.config.ts`,
and point `vitest.configFile` at it.

If the code under test depends on Node's own module semantics, set
`test.experimental.viteModuleRunner: false` so Vitest uses Node's
`import` instead of Vite's module runner. See "Vitest: code that depends
on Node's module semantics fails under Vite's module runner" in
`troubleshooting.md`.

## 5. Write the Stryker config

Write one config file per runner. Both examples below hold the same
`mutate`, `ignorePatterns`, and `disableTypeChecks` shape; adjust the
file lists to what you picked in step 1.

Tap runner:

```json
{
  "testRunner": "tap",
  "tap": {
    "testFiles": ["test/my-module.test.ts"]
  },
  "mutate": ["src/my-module.ts"],
  "disableTypeChecks": "src/my-module.ts",
  "coverageAnalysis": "perTest",
  "reporters": ["clear-text", "progress", "html", "json"],
  "ignorePatterns": ["dist"]
}
```

Vitest runner:

```json
{
  "testRunner": "vitest",
  "vitest": {
    "configFile": "vitest.mutation.config.ts"
  },
  "mutate": ["src/my-module.ts"],
  "disableTypeChecks": "src/my-module.ts",
  "reporters": ["clear-text", "progress", "html", "json"],
  "ignorePatterns": ["dist"]
}
```

The vitest runner ignores `coverageAnalysis` and always uses `perTest`,
so the Vitest example leaves it out.

`disableTypeChecks` takes one glob string, or a boolean; it does not take
an array. Set it to the same glob as `mutate`; see
"`disableTypeChecks: true` touches files you did not mean to mutate" in
`troubleshooting.md`. If the project installs TypeScript 7, see
"TypeScript 7 has no JS API for tsconfig rewriting" in
`troubleshooting.md`.

A config file option can carry a sibling key named `<option>_comment`,
holding free text; Stryker ignores it. Use it to record why you chose a
setting.

## 6. Ignore the artifacts

Stryker writes two kinds of output: a sandbox directory (`tempDirName`,
`.stryker-tmp` by default) where it copies your code to mutate it, and a
reports directory (`reports/`, holding the html and json reports). Add
both to your version control ignore file.

`tempDirName` is deleted in full after a successful run. Do not point it
at a directory that holds anything you want to keep.

Use `ignorePatterns` to keep large directories that your tests do not
need out of the sandbox copy. This speeds up Stryker's startup on a
large repository. Stryker always leaves out `node_modules`, `.git`, the
`tempDirName` directory, and its own report files, so you do not need to
list them.

## 7. Dry-run before a real run

Run `npx stryker run --dryRunOnly`. This runs your tests once, without
introducing a mutant, and confirms the setup works.

A test that fails here usually falls into one of the kinds listed in
step 1. To confirm the cause: run Stryker once with `cleanTempDir: false`
and a `tempDirName` set apart from your usual one, so the sandbox
survives the run. Then run the failing test directly inside that
sandbox directory and read its output.

## 8. Run one file first

Run `npx stryker run --mutate <file>`. Pass
`--incrementalFile <a separate file>` so this run does not overwrite your
usual incremental file. `--incremental` is a flag on the command line; it
takes no value. `--incremental false` is read as a config file name, and
fails.

## 9. Run the whole scope, in incremental mode

Set `"incremental": true` in the config, and run the full scope. The
progress line shows a remaining-time estimate; check it in the first few
minutes. The first minute goes fast, because Stryker clears every
no-coverage mutant first.

To stop a run, send SIGINT (Ctrl-C) to Stryker's own process. Stryker
saves the partial result to the incremental file; its own docs describe
this under "Interrupted runs". A stopped run printed "Saved a partial
incremental report" during testing.

After a stop, or after a timeout, check for a process Stryker's sandbox
started but did not stop: `pgrep -fl .stryker-tmp`. Stop any process
you find, then delete `.stryker-tmp`.

As a precaution, when you switch to a different runner, move the old
incremental file aside before you run again. Each runner names its
tests differently, so Stryker's reuse check does not line up across
runners. Stryker's own incremental docs do not state this; it is a
precaution from this guide.

## 10. Next

For how to read the result, see `results.md`. For how to classify a
surviving mutant, see `references/general/triage.md`.
