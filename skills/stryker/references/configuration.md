# StrykerJS configuration options

Each option's meaning and default live in the installed package's own
schema. Read one option:

```
jq -r '.properties.<option>.description' node_modules/@stryker-mutator/core/schema/stryker-schema.json
```

List every option name:

```
jq -r '.properties | keys[]' node_modules/@stryker-mutator/core/schema/stryker-schema.json
```

A runner's own options sit in its own schema file, at
`node_modules/@stryker-mutator/<runner>/dist/schema/<runner>-options.json`.
For prose, read Stryker's configuration docs at the tag that matches
your installed version:
`https://github.com/stryker-mutator/stryker-js/blob/v<version>/docs/configuration.md`.

The notes below are not in either schema.

## A command-line option replaces its config file option

A command-line option fully replaces the matching config file option; the
two do not merge.

## `mutate` supports a line range

`mutate` can point at part of a file, not only a whole file. Postfix the
path with `:startLine[:startColumn]-endLine[:endColumn]`, for example
`"src/app.js:5-7"`. This is also in the schema's own `mutate`
description; it is repeated here because it is easy to miss.

## `--incremental` takes no value on the command line

`--incremental` is a flag; it takes no value. `--incremental false` on
the command line is read as a config file name, and fails.

## The timeout formula

`timeoutMS` and `timeoutFactor` feed one formula:
`timeoutForTestRunMs = netTimeMs * timeoutFactor + timeoutMS + overheadMs`.
Neither option's own description states this formula.

## `ignoreStatic` needs `perTest` coverage analysis

`ignoreStatic` skips a static mutant: one whose code runs only while the
file loads, not inside a test. It requires
`"coverageAnalysis": "perTest"`. The schema's own description does not
state this requirement.

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
