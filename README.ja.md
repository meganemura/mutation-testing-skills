# mutation-testing-skills

mutation testing のための Claude Code の skill 集です。
1 つの skill が 1 つの道具を受け持ち、エージェントに、導入、実行、結果の読み方、生き残ったミュータントへの対処を案内します。

## 中身

- `skills/stryker/`: [StrykerJS](https://stryker-mutator.io/) の skill です。
  JavaScript と TypeScript が対象です。
  `scripts/digest.mjs` を含みます。
  これは Stryker の report を、エージェントが行動に移せる生き残りの一覧に変えます。
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

このリポジトリにある skill の一覧は、`npx skills add meganemura/mutation-testing-skills --list` で見られます。
今のプロジェクトだけに入れるときは、`-g` を外します。

CLI は、skill の `references/general` の link をディレクトリとしてコピーします。
なので、入れた skill は、共有の references も一緒に持ちます。

## エージェント向けの文脈

`AGENTS.md`(と、その symlink の `CLAUDE.md`)に、このリポジトリで作業するエージェント向けの構成と規約があります。
