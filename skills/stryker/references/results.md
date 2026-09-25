# Read a StrykerJS result

## Use digest.mjs first

Run `scripts/digest.mjs` on the report before you read the JSON or the
clear-text output by hand. It lists each survivor with a stable id, a
diff, the covering tests, and a command that reruns just that mutant.
See `digest.md`.

## Status names

Stryker reports each mutant with one of these statuses. The right column
maps each to the tool-neutral term in `references/general/concepts.md`.

| Stryker status | General term |
| --- | --- |
| Killed | detected (a test killed it) |
| Timeout | detected (the run did not finish in time) |
| Survived | survived |
| NoCoverage | no coverage |
| CompileError | invalid |
| RuntimeError | invalid |
| Ignored | ignored |
| Pending | not yet run |

## Score formulas

Stryker computes these sums from the status counts above:

- `detected = killed + timeout`
- `undetected = survived + noCoverage`
- `covered = detected + survived`
- `valid = detected + undetected`
- `invalid = runtimeErrors + compileErrors`
- `mutation score = detected / valid × 100`
- `score for covered code = detected / covered × 100`

`Ignored` and `invalid` mutants are excluded from both scores' denominators.

## Reading the clear-text report

The `clear-text` reporter (on by default) prints a score table by file
and, for each surviving or timed-out mutant, the mutator name, the file
location, and a diff of the change. Use this output first; open the html
report when you want to browse mutants interactively.

## Reading the json report

`reports/mutation/mutation.json` holds the full result. Each entry under
`files` has a `mutants` array; each mutant has `status`, `mutatorName`,
`location.start.line`, and `replacement`. To list mutants of one status
from the command line:

```
node -e "
const r = require('./reports/mutation/mutation.json');
for (const f of Object.values(r.files)) {
  for (const m of f.mutants) {
    if (m.status === 'Survived') {
      console.log(m.mutatorName, m.location.start.line, m.replacement);
    }
  }
}
"
```

## Mutator names

The mutators Stryker's instrumenter applies: ArithmeticOperator,
ArrayDeclaration, ArrowFunction, AssignmentOperator, BlockStatement,
BooleanLiteral, CallExpression, ConditionalExpression, EqualityOperator,
LogicalOperator, MethodExpression, ObjectLiteral, OptionalChaining,
Regex, StringLiteral, UnaryOperator, UpdateOperator.

## A worked example

A 38-line file that builds a UUID v7 value, tested with a run against
that file and its test, produced 32 mutants in 3 seconds: 25 killed, 2
timed out, 5 survived, 0 with no coverage. Score: 84.38%.

The two timeouts:

- A `BlockStatement` mutant that replaced a counter-overflow branch's body
  with `{}`.
- An `UpdateOperator` mutant that changed `i--` to `i++`, producing an
  infinite loop.

The five survivors, and what each showed:

- `crypto.getRandomValues(bytes);` mutated to `;` (`CallExpression`)
  survived: the test did not check the random portion of the output.
- `let lastMs = -1;` mutated to `+1` (`UnaryOperator`) survived. It looks
  equivalent, but it is a missing boundary case. Suppose the first call in
  the process passes a timestamp of 0. The original uses 0 as the
  timestamp. The mutant uses 1, because it takes the larger of the
  timestamp and `lastMs`. A first call with a timestamp of 0 or 1 kills
  it. The tap runner starts a new process for each test file, so a test
  file can control the first call. Check this kind of reasoning before
  you disable a mutant as equivalent.
- `if (ms === lastMs)` mutated to `if (true)` (`ConditionalExpression`),
  and its `else` body mutated to `{}` (`BlockStatement`), both survived:
  the test did not check the counter's random starting value.
- `counter > 0xfff` mutated to `>=` (`EqualityOperator`) survived: a
  missing boundary-value test.

## The progress reporter outside a terminal

The `progress` reporter falls back to `progress-append-only` when
standard output is not a TTY, for example when a run's output is piped to
a file or another process.
