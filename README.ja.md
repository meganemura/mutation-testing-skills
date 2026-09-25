Language: [English](README.md) | **日本語**

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
  各 skill がこの資料にどう届くかは、`docs/adr/0001-shared-references.md` にあります。

## skill を入れる

Claude Code は、個人の skill を `~/.claude/skills/` の下のディレクトリから読み込みます。
このリポジトリを clone してから、使いたい skill をそのディレクトリに link します。

```
ln -s <repo>/skills/stryker ~/.claude/skills/stryker
```

`<repo>` は、このリポジトリを clone したパスに置き換えてください。

## エージェント向けの文脈

`AGENTS.md`(と、その symlink の `CLAUDE.md`)に、このリポジトリで作業するエージェント向けの構成と規約があります。
