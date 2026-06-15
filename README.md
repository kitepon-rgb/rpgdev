# RPGDev Hook Adventure

Codex / Claude Code の Hook イベントを、小さい RPG 風デスクトップウィンドウの演出に変換する macOS アプリです。

**モンスターはランダムエンカウントで出現します。** ツールを使うたび（`PreToolUse`）に 20% の確率で1体だけ敵が現れ、戦闘になります。スプライトと HP は Slime / Goblin / Orc / Ogre からランダムに選ばれます。ツールを使うたびに勇者がスキル攻撃します（`PostToolUse`＝技名がツール名（整形：PascalCase、MCP はサーバ名）のスキル攻撃。`PreToolUse` は攻撃せず、エンカウント出現／精霊増援／前進のみ）。敵を倒すと探索に戻ります。待機中は街、作業中はフィールドを探検、エンカウントの敵が画面にいる間だけ戦闘になります。

討伐条件は出現タイミングで変わります。**進行中の TODO が無いとき**に出た敵は、勇者のスキル攻撃（`PostToolUse`）5回、またはターン終了（`Stop`）で討伐します。**進行中（`in_progress`）の TODO があるとき**に出た敵はその項目に紐づき、攻撃では倒せず、TODO 項目が1つ `completed` になった瞬間、またはターン終了（`Stop`）で討伐します。`Stop` は TODO status の整理漏れが残っても戦闘を次ターンへ持ち越さない最終クリーンアップです。HP は演出専用です。ツールが失敗すると敵が反撃します（Claude は `PostToolUseFailure` などで検知。Codex は hook がツールの成否を出さないため反撃は出ません）。

TODO リスト（Claude の TodoWrite / Codex の update_plan）はクエストとして画面上部に一覧表示され、紐づくエンカウントの討伐トリガーになります。モンスターは湧かしません。

**冒険ステージ**は TODO の進捗に合わせて草原（field）→ 洞窟（dungeon）→ 城（castle）と奥へ進みます。TODO 一覧を3区画に分け、達成していくほど背景と BGM が切り替わります（TODO が無いセッションは草原のまま）。

**戦闘の駆け引き（v0.5.0）**：

- 在席している精霊（仲間）は、勇者のスキル攻撃のあとに**全員がランダムな順で追撃**します。
- 勇者と全精霊が攻撃し切って演出キューが空くと、**モンスターが8秒おきに反撃**します（対象は勇者か在席精霊からランダム）。被弾エフェクトと被ダメージ効果音（`damage-hit`）が出ます。
- 各精霊は**被弾を5回受けると退場**します（残ライフはサーバーが管理）。
- 戦闘から探索へ戻る瞬間は、**タイトル画の全画面トランジション**（「Explore the Dungeon」等のテキストが右上→中央→左下へ流れる）で覆い、勇者の配置が一瞬で変わる違和感を消します。
- クエスト一覧は**親（最初に入力した）セッション専用**で、サブエージェントや別プロセス（別の `codex`/`claude` 実行）の入力では書き換わりません。
- `SubagentStart` / `SubagentStop` を使うと、サブエージェントの参戦／離脱で精霊が増援／帰還します（`examples/` のサンプル設定に含まれています）。

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
- `PreToolUse`: 20% でモンスターのエンカウント出現判定、戦闘中なら 10% で精霊の増援判定、出なければ前進（**攻撃はしない＝勇者の通常攻撃は廃止**。攻撃は `PostToolUse` のスキル攻撃だけ）
- `PostToolUse`:
  - `TodoWrite` / `update_plan` → クエスト一覧を更新（`pending`＝未着手, `in_progress`＝進行中, `completed`＝達成）。各項目を冒険ステージ（field/dungeon/castle）に割り当て。新たに `completed` になった項目があれば、紐づくエンカウントを討伐
  - それ以外のツール → スキル攻撃（技名＝ツール名を整形：PascalCase、MCP はサーバ名。例: `Bash`→Bash、`apply_patch`→ApplyPatch、`spawn_agent`→SpawnAgent、`mcp__aiterm__pty_read`→Aiterm。コマンド/パッチ本文は見ないので Codex `apply_patch` でも「***」にならない）。在席している精霊もこの時だけ追撃する
- `PostToolUseFailure` / `PermissionDenied`（Claude のみ）: 敵が反撃。Codex は hook に成否が出ないため反撃なし
- `SubagentStart` / `SubagentStop`: 精霊の仲間が参戦 / 帰還（FIFO＝最初に出た仲間から帰る）。モンスター討伐時は、撃破演出を見せ切ってから精霊を1体ずつ順番に帰還させ（属性色エフェクト＋帰還音）、全員帰り切ってから背景を切り替える
- `Stop`: ターン終了。在席エンカウントを TODO 紐づきの有無に関係なく討伐し、街へ戻る（街＝待機ではクエスト窓は畳む）

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
- 探索背景: `public/assets/field.png`, `public/assets/dungeon.png`, `public/assets/castle.png`
- 戦闘→探索トランジションのタイトル一枚絵: `public/assets/title.png`
- 勇者: `public/assets/sprites/hero.png`, `hero-relax.png`, `hero-battle.png`
- モンスター: `public/assets/sprites/slime.png`, `goblin.png`, `orc.png`, `ogre.png`
- 仲間精霊: `public/assets/sprites/ally-fire.png`, `ally-earth.png`, `ally-wind.png`, `ally-water-facing-slit.png`
  （残ライフ3以下では `ally-fire-damaged.png`, `ally-earth-damaged.png`, `ally-water-damaged.png`, `ally-wind-damaged.png` に差し替え）
  （水精霊の別案として `ally-water.png`, `ally-water-facing.png` も同梱）
- BGM: `public/audio/field.wav`, `adventure.wav`, `battle.wav`, `dungeon-adventure.wav`, `dungeon-battle.wav`, `castle-adventure.wav`, `castle-battle.wav`
- 効果音: `public/audio/monster-appear.wav`, `public/audio/monster-defeat.wav`, `hero-normal-attack.wav`, `hero-skill-attack.wav`, `hero-finisher-attack.wav`, `ally-fire-attack.wav`, `ally-earth-attack.wav`, `ally-wind-attack.wav`, `ally-water-attack.wav`, `ally-return.wav`（精霊が撃破後に1体ずつ帰還する音）, `damage-hit.wav`（勇者/精霊がモンスターの反撃を受けた時の被ダメージ音）
- フォント: `public/fonts/cinzel.woff2`（全画面トランジションのタイトル文字。自己ホスト・OFL）

BGM は既存曲のメロディを使わないオリジナルのクラシック JRPG 調シーケンスで、冒険ステージ（草原 / 洞窟 / 城）×
探索・戦闘の7トラックを `scripts/render-bgm.mjs` から生成します（洞窟は不穏で低速、城は荘厳な行進調）。
攻撃効果音は `scripts/render-sfx.mjs` から生成します。`monster-appear.wav` / `monster-defeat.wav` は render-bgm/render-sfx 管轄外の別アセットで、`npm run render:bgm` では再生成されません。

デスクトップウィンドウは WKWebView なので、CSS/画像/JS を更新した後に既存ウィンドウへ反映されない時は
ウィンドウを開き直してください。

## Development

```bash
npm test
npm run render:bgm        # BGM(7トラック)を再生成
npm run render:sfx        # 攻撃/帰還の効果音を再生成
npm run build:desktop     # Swift ウィンドウのコンパイル
npm run trace             # 演出トレース解析（.rpgdev/ のログから二連続/欠落/取りこぼしを検出）
```

`.rpgdev/` には現在の状態（`state.json`）に加え、演出の診断ログ（`events.ndjson`＝reducer の emit、`playback.ndjson`＝
ウィンドウが実際に再生/取りこぼした演出。各レコードに由来 Hook が付く）が残ります。`npm run trace` で突き合わせて解析できます。

## License

MIT
