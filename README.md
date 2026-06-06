# RPGDev Hook Adventure

Codex / Claude Code の Hook イベントを、小さい RPG 風デスクトップウィンドウの演出に変換する macOS アプリです。

**TODO（作業項目）をモンスターに見立てます。** エージェントの TODO リスト（Claude の TodoWrite / Codex の update_plan）の各項目が1体のモンスターとして出現し、`in_progress` の項目が「いま戦っている敵」になります。ツールを使うたびに攻撃（`PreToolUse`＝通常攻撃 / `PostToolUse`＝技名がツール名のスキル攻撃）、項目が `completed` になるとトドメで撃破します。待機中は街、作業中はフィールドを探検、`in_progress` の項目と対峙すると戦闘になります。

HP は演出用で攻撃では倒せません（瀕死で粘る）。撃破は TODO が完了した瞬間だけ。ツールが失敗すると敵が反撃します（Claude は `PostToolUseFailure` で検知。Codex は hook がツールの成否を出さないため反撃は出ません）。TODO を使わないセッションは戦闘にならず、平和な探検になります。

設計の詳細・実機検証の根拠は [docs/design-todo-rpg.md](docs/design-todo-rpg.md) を参照。

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

- `UserPromptSubmit`: 冒険開始、ウィンドウを開く、フィールドへ
- `PreToolUse`: 通常攻撃（戦闘中の `in_progress` モンスターへ）。敵がいなければ探検で前進
- `PostToolUse`:
  - `TodoWrite` / `update_plan` → モンスター名簿を更新（`pending`＝待機列, `in_progress`＝現在の敵, `completed`＝撃破）
  - それ以外のツール → スキル攻撃（技名＝ツール名）。失敗時は敵が反撃
- `PostToolUseFailure`（Claude のみ）: 敵が反撃。Codex は hook に成否が出ないため反撃なし
- `SubagentStart` / `SubagentStop`: 精霊の仲間が参戦 / 帰還。戦闘中は仲間も現在の敵を追撃する
- `Stop`: 未完了の TODO（モンスター）が無ければ一区切り。残っていれば戦線維持

モンスターの出現・撃破は TODO の状態変化だけが駆動します（エラーの単語マッチでは湧きません）。
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
- 仲間精霊: `public/assets/sprites/ally-fire.png`, `ally-earth.png`, `ally-wind.png`, `ally-water-facing-slit.png`
  （水精霊の別案として `ally-water.png`, `ally-water-facing.png` も同梱）
- BGM: `public/audio/field.wav`, `adventure.wav`, `battle.wav`

BGM は既存曲のメロディを使わないオリジナルのクラシック JRPG 調シーケンスです。`adventure.wav` と
`battle.wav` は `scripts/render-bgm.mjs` から生成され、戦闘・探索の厚みを出すアレンジにしています。

デスクトップウィンドウは WKWebView なので、CSS/画像/JS を更新した後に既存ウィンドウへ反映されない時は
ウィンドウを開き直してください。

## Development

```bash
npm test
npm run render:bgm
npm run build:desktop
```

## License

MIT
