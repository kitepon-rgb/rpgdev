# RPGDev Hook Adventure

Codex / Claude Code の Hook イベントを、小さい RPG 風デスクトップウィンドウの演出に変換する macOS アプリです。

**モンスターはランダムエンカウントで出現します。** ツールを使うたび（`PreToolUse`）に 20% の確率で1体だけ敵が現れ、戦闘になります。スプライトと HP は Slime / Goblin / Orc / Ogre からランダムに選ばれます。ツールを使うたびに攻撃し（`PreToolUse`＝通常攻撃 / `PostToolUse`＝技名がツール名のスキル攻撃）、敵を倒すと探索に戻ります。待機中は街、作業中はフィールドを探検、エンカウントの敵が画面にいる間だけ戦闘になります。

討伐条件は出現タイミングで変わります。**進行中の TODO が無いとき**に出た敵は、通常攻撃5回、またはターン終了（`Stop`）で討伐します。**進行中（`in_progress`）の TODO があるとき**に出た敵はその項目に紐づき、攻撃では倒せず、TODO 項目が1つ `completed` になった瞬間に討伐します（進行中 TODO が無くなれば紐づきが解け、以降は5撃／ターン終了で倒せます）。HP は演出専用です。ツールが失敗すると敵が反撃します（Claude は `PostToolUseFailure` などで検知。Codex は hook がツールの成否を出さないため反撃は出ません）。

TODO リスト（Claude の TodoWrite / Codex の update_plan）はクエストとして画面上部に一覧表示され、紐づくエンカウントの討伐トリガーになります。モンスターは湧かしません。

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
- `PreToolUse`: 通常攻撃。さらに 20% でモンスターのエンカウント判定、戦闘中なら 20% で精霊の増援判定も行う（出現・増援判定は Pre のみ）
- `PostToolUse`:
  - `TodoWrite` / `update_plan` → クエスト一覧を更新（`pending`＝未着手, `in_progress`＝進行中, `completed`＝達成）。新たに `completed` になった項目があれば、紐づくエンカウントを討伐
  - それ以外のツール → スキル攻撃（技名＝ツール名）
- `PostToolUseFailure` / `PermissionDenied`（Claude のみ）: 敵が反撃。Codex は hook に成否が出ないため反撃なし
- `SubagentStart` / `SubagentStop`: 精霊の仲間が参戦 / 帰還（LIFO）。戦闘中は仲間も現在の敵を追撃する
- `Stop`: TODO に紐づかないエンカウントはターン終了で討伐。紐づくエンカウントは戦線維持

モンスターはランダムエンカウント（ツール使用ごと 20%）で出現し、討伐条件は出現時に進行中 TODO があったかで決まります。
Hook がサーバへ送れない場合は静かに成功扱いせず、stderr と `.rpgdev/hook-errors.log` にエラーを出します。

## Demo

別ターミナルで `rpgdev` または `rpgdev-server` を起動した状態で:

```bash
npm run demo
```

このリポジトリを clone している場合は、エンカウント出現・攻撃・討伐・一区切りまでを疑似 Hook イベントで流せます。

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
