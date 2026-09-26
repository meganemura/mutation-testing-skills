# Gate a pull request on a committed baseline

This reference sets up the full-run gate of
`references/general/operations.md` (section 3) with mutineer 1.0.2. Use it
when a full run over the project takes a few minutes. For a larger
project, gate on the changed lines with `--since` instead.

## 1. What `--baseline` reads

`mutineer run --baseline FILE` compares the run with an earlier
`--format json` report. It fails with exit code 1 on a survivor whose `id`
is not in the report, or on a score below the report's score. From the
report, it reads only four fields: `schema_version`, `summary.score`,
`summary.scoped`, and each survivor's `id`. It refuses a report whose
`summary.scoped` is true, because a `--since` run covers only that diff.

## 2. Write the baseline for review

mutineer writes its report as one line of JSON. Committed as it is, a
change to the survivors shows as one changed line in a pull request.
Write a smaller file instead: the four fields, one survivor per line,
sorted, without line numbers. A line number changes on every edit above
the survivor, and the `id` does not depend on it. Keep a readable
`change` field, so a reviewer can see what each survivor is.

```ruby
require "json"

report = JSON.parse(File.read(".mutineer/baseline-run.json"))
abort "rewrite the baseline from a full run" if report.dig("summary", "scoped")
rows = report.fetch("survivors").map do |s|
  change = s.fetch("diff").lines.grep(/^[-+] /).map { |l| l.chomp.sub(/^([-+]) +/, '\1 ') }.join(" | ")
  {"id" => s.fetch("id"), "file" => s.fetch("file"), "subject" => s.fetch("subject"),
   "operator" => s.fetch("operator"), "change" => change}
end
rows.sort_by! { |r| r.values_at("file", "subject", "id") }
text = +"{\n"
text << %(  "schema_version": #{report.fetch("schema_version").to_json},\n)
text << %(  "summary": #{report.fetch("summary").slice("score", "scoped").to_json},\n)
text << %(  "survivors": [\n#{rows.map { |r| "    #{r.to_json}" }.join(",\n")}\n  ]\n}\n)
leak = [Dir.pwd, Dir.home].find { |path| text.include?(path) }
abort "the baseline would contain #{leak}" if leak
File.write("test/mutation-baseline.json", text)
```

The check for `Dir.pwd` and `Dir.home` matters when the repository is
public. The fields above hold paths relative to the project, but an
error message in another field can hold an absolute path.

Wrap the full run and this step in one project task, for example
`rake mutation:baseline`. Wrap the gate in another, for example
`rake mutation`, which runs with `--baseline test/mutation-baseline.json`.

## 3. Allow for timeouts on a slow machine

A hosted CI machine is slower than a developer's machine. A mutant that is
killed locally can time out there. A timeout leaves the score's
denominator, so the score can drop by a fraction of a point, and the gate
fails on the score alone. A timeout never adds a survivor. Pass
`--baseline-epsilon 1` with the gate, so that the survivor ids stay the
gate.

## 4. Mark an equivalent mutant beside its code

A survivor that no test can kill goes out of the baseline and into the
source, as a `# mutineer:disable-line <operator>` marker on its line. Write
the reason in a comment on the line above:

```ruby
# The parent's initialize sets nothing, so removing this call is equivalent.
super() # mutineer:disable-line statement_removal
```

Do not write the reason after the marker on the same line. mutineer reads
each word after the marker as an operator name, so
`# mutineer:disable-line statement_removal because ...` matches no
operator and suppresses nothing, with no warning. Reported to mutineer:
https://github.com/davidteren/mutineer/issues/124

`.mutineer.yml` also takes an `ignore:` list of ids. Prefer the marker: it
moves with the code, and the reason sits next to it
(`references/general/operations.md`, section 4).

## 5. Day to day

- A pull request that kills a survivor passes without a change to the
  baseline. The next rewrite shows the survivor as one removed line.
- A pull request that adds a survivor fails. Add a test, mark the mutant
  as equivalent, or accept it by rewriting the baseline. An accepted
  survivor shows as one added line in the diff.
- Run the gate on one platform and one Ruby, because each run costs
  minutes.
