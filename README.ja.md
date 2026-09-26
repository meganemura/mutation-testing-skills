# mutation-testing-skills

mutation testing のための Claude Code の skill 集です。
1 つの skill が 1 つの道具を受け持ち、エージェントに、導入、実行、結果の読み方、生き残ったミュータントへの対処を案内します。

## 中身

- `skills/stryker/`: [StrykerJS](https://stryker-mutator.io/) の skill です。
  JavaScript と TypeScript が対象です。
  [stryker-agent-reporter](https://github.com/meganemura/stryker-agent-reporter) の出力を読みます。
  これは Stryker の実行結果を、エージェントが行動に移せる生き残りの一覧に変えます。
- `skills/mutineer-practice/`: [mutineer](https://github.com/davidteren/mutineer) の skill です。
  Ruby の Minitest か RSpec が対象です。
  導入と、実測した落とし穴を持ちます。
  CLI とエージェントの手順を持つ、mutineer の作者自身の `mutineer` skill と一緒に入れてください。
- `references/`: 道具に依らない mutation testing の一般論です。
  このリポジトリのすべての skill が共有します。
  変更の差分だけで pull request を関門にかける方法(`references/operations.md`)も含みます。
  各 skill がこの資料にどう届くかは、`docs/adr/0001-shared-references.md` にあります。

## skill を入れる

skill は [`skills`](https://github.com/vercel-labs/skills) の CLI で入れます。
次のコマンドは、StrykerJS の skill を、Claude Code のすべてのプロジェクトで使えるように入れます。

```
npx skills add meganemura/mutation-testing-skills --skill stryker -g -a claude-code
```

次の 2 つは、mutineer の作者自身の skill と、このリポジトリの skill を、両方とも Claude Code のすべてのプロジェクトで使えるように入れます。
作者の skill は URL から入れます。
`davidteren/mutineer` として入れると、docs のサイト全体が一緒に入ります。

```
npx skills add https://davidteren.github.io/mutineer/skill.md -g -a claude-code
npx skills add meganemura/mutation-testing-skills --skill mutineer-practice -g -a claude-code
```

このリポジトリにある skill の一覧は、`npx skills add meganemura/mutation-testing-skills --list` で見られます。
今のプロジェクトだけに入れるときは、`-g` を外します。

CLI は、skill の `references/general` の link をディレクトリとしてコピーします。
なので、入れた skill は、共有の references も一緒に持ちます。

## エージェント向けの文脈

`AGENTS.md`(と、その symlink の `CLAUDE.md`)に、このリポジトリで作業するエージェント向けの構成と規約があります。
