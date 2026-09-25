# StrykerJS configuration options

The options most often needed. See Stryker's own configuration docs for
the full list.

- `mutate` [`string[]`]: the production files to mutate. Supports a line
  range: `"src/app.js:5-7"` mutates only lines 5 through 7.
- `testRunner` [`string`]: the test runner plugin to use, such as `"tap"`
  or `"jest"`.
- `testFiles` [`string[]`]: limit which test files run during mutation
  testing.
- `coverageAnalysis` [`string`]: `"off"`, `"all"`, or `"perTest"`.
  `"perTest"` is the default and runs only the tests that cover each
  mutant.
- `reporters` [`string[]`]: which reporters to use, such as `"clear-text"`,
  `"html"`, `"json"`, `"progress"`.
- `thresholds` [`object`]: `{ "high": 80, "low": 60, "break": null }`.
  Set `break` to a number to fail the build when the score drops below
  it.
- `incremental` [`boolean`] and `incrementalFile` [`string`]: enable
  incremental mode and choose where its result file lives. See
  `references/general/scoping.md`.
- `force` [`boolean`]: rerun every mutant even when an incremental file
  exists.
- `concurrency` [`number` | `string`]: the number of worker processes, or
  a percentage of CPU cores.
- `timeoutMS` [`number`] and `timeoutFactor` [`number`]: control how long
  a mutant's test run may take before Stryker treats it as a timeout.
  The formula: `timeoutForTestRunMs = netTimeMs * timeoutFactor + timeoutMS + overheadMs`.
- `ignoreStatic` [`boolean`]: skip static mutants, mutants whose code runs
  only while the file loads, not inside a test. Requires
  `"coverageAnalysis": "perTest"`.
- `disableTypeChecks` [`boolean` | `string`]: disable TypeScript type
  checking for the given files, since a mutant often introduces a type
  error that has nothing to do with the mutant's test result.
- `checkers` [`string[]`]: enable a checker plugin, such as `"typescript"`,
  to reject a mutant that fails to type-check.
- `tsconfigFile` [`string`]: the tsconfig Stryker rewrites for the
  sandbox. Also used by the TypeScript checker.
- `ignorePatterns` [`string[]`]: files or directories to leave out of the
  sandbox copy. Does not affect which files are mutated; use `mutate` for
  that.
- `tempDirName` [`string`]: the sandbox directory name. Deleted after a
  successful run.
- `cleanTempDir` [`boolean` | `"always"`]: whether to delete the temp
  dir, and when.
- `dryRunOnly` [`boolean`]: run the initial test run only, without
  mutating. Useful to confirm the setup works before a full run.
- `logLevel` [`string`]: console log level. One of `off`, `fatal`, `error`,
  `warn`, `info`, `debug`, `trace`.

A command-line option fully replaces the matching config file option; the
two do not merge.

## Disabling a mutant

Three ways, from broadest to narrowest:

- `mutator.excludedMutations`: an array of mutator names to exclude
  everywhere.
- A `// Stryker disable next-line <Mutator>: <reason>` comment: disables
  one mutator on one line, with a stated reason. Drop `next-line` to
  disable from that point on; use `all` in place of a mutator name to
  disable every mutator; use `restore` to turn a disable back on lower in
  the file.
- An ignore plugin: a small plugin that inspects each syntax tree node and
  returns a reason to skip it. Use this when the same pattern, such as a
  logging call, recurs across many files.

A disabled mutant keeps the `ignored` status in the report and does not
count toward the score.
