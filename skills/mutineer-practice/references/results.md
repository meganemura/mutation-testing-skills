# Read a mutineer result

Run with `--format json`. The report's shape and its versioning contract
are in the author's
[JSON schema reference](https://github.com/davidteren/mutineer/blob/v1.0.2/docs/json-schema.md).
This page maps its fields onto the tool-neutral terms in
`references/general/concepts.md`.

## Status names

| mutineer status | General term |
| --- | --- |
| killed | detected |
| survived | survived |
| no_coverage | no coverage |
| uncapturable | invalid (the covering test errored during coverage capture, not a test gap) |
| skipped_invalid | invalid |
| errored | invalid |
| timeout | detected |
| ignored | ignored |

`errored`, `timeout`, and `uncapturable` mutants that were attempted and
produced no verdict appear under `no_verdict[]`.

## Score formula

`summary.score` is `killed / (killed + survived) * 100`, rounded.
`no_coverage` and `no_verdict` mutants are outside this denominator. The
score is `null`, not `0.0`, when the denominator is empty.

A score of `null` with every mutant under `no_coverage` or `uncapturable` means no test
ran at all. Do not read this as a weak suite. Go to
`references/troubleshooting.md`'s first entry, on the load path.

## The stable id

Each entry in `survivors[]` and `ignored[]` carries an `id`: a stable
key that does not depend on the mutant's position in the file. Use it in
`.mutineer.yml`'s `ignore:` list, to suppress a mutant judged
equivalent, and it is what `--baseline` matches on between two runs.

## Where to look first

Read `no_verdict[]` when the score looks better than expected: a mutant
counted there is excluded from the denominator, so a broken harness
raises the score rather than lowering it.
