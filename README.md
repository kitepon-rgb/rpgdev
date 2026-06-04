# RPGDev Hook Adventure

Codex / Claude Code の Hook イベントを、小さい RPG 風デスクトップウィンドウの演出に変換する macOS アプリです。

エラーが出るとモンスターが出現し、解決ステップごとにダメージを与え、解決したら撃破します。待機中は街で勇者がくつろぎ、作業が始まると冒険フィールドを歩き、戦闘中はモンスターと向き合います。

## Install

```bash
npm install -g rpgdev
```

Requirements:

- macOS
- Node.js 20+
- Swift compiler / Xcode Command Line Tools

## Start

```bash
rpgdev
```

macOS のデスクトップ右上に小さい RPGDev ウィンドウが開きます。状態やログは、実行したプロジェクトの `.rpgdev/` に保存されます。

Web 版だけを開きたい場合:

```bash
rpgdev-server --open
```

表示: `http://127.0.0.1:37373/`

## Hooks

Hook からは `rpgdev-hook` を呼びます。

```bash
rpgdev-hook codex UserPromptSubmit
rpgdev-hook claude PostToolUse
```

サンプル設定:

- Codex: `examples/codex-hooks.json`
- Claude Code: `examples/claude-settings.local.json`

Codex では `examples/codex-hooks.json` の内容をプロジェクトの `.codex/hooks.json` に置きます。Claude Code では `examples/claude-settings.local.json` の内容をプロジェクトの `.claude/settings.local.json` に置きます。

Codex / Claude Code 側で project-local hooks の trust / review が必要な場合があります。

## Hook Flow

- `UserPromptSubmit`: 冒険開始、ウィンドウを開く、探索 BGM
- `PreToolUse`: TODO / 作業ステップとして冒険進行。戦闘中ならダメージ
- `PostToolUse`: 成功なら進行または攻撃。失敗 payload ならモンスター出現
- `PostToolUseFailure` / `PermissionDenied` / `StopFailure`: モンスター出現
- `Stop`: モンスターがいなければ一区切り。残っていれば戦闘継続

Hook がサーバへ送れない場合は静かに成功扱いせず、stderr と `.rpgdev/hook-errors.log` にエラーを出します。

## Demo

別ターミナルで `rpgdev` または `rpgdev-server` を起動した状態で:

```bash
npm run demo
```

このリポジトリを clone している場合は、失敗、モンスター出現、修正ステップ、撃破、一区切りまでを疑似 Hook イベントで流せます。

## BGM And Assets

- 待機背景: `public/assets/town.png`
- 探索背景: `public/assets/field.png`
- 勇者: `public/assets/sprites/hero.png`, `hero-relax.png`, `hero-battle.png`
- モンスター: `public/assets/sprites/slime.png`, `goblin.png`, `orc.png`, `ogre.png`
- BGM: `public/audio/field.wav`, `adventure.wav`, `battle.wav`

BGM は既存曲のメロディを使わないオリジナルのクラシック JRPG 調シーケンスです。

## Development

```bash
npm test
npm run render:bgm
npm run build:desktop
```

## License

MIT
