[English](README.md) | **日本語**

# RPGDev Hook Adventure

Codex / Claude Code の Hook イベントを、小さい RPG 風デスクトップウィンドウの演出に変換するアプリです（macOS / Windows / WSL2 対応）。

**モンスターはランダムエンカウントで出現します。** ツールを使うたび（`PreToolUse`）に 20% の確率で1体だけ敵が現れ、戦闘になります。スプライトと HP は冒険ステージ別の敵カタログ（草原は Slime / Goblin / Orc / Ogre、洞窟は Skeleton / Ghoul / Witch / Grim Reaper / Succubus、城は Dullahan / Dragon / Demon Lord ほか）から、その時いるステージに応じてランダムに選ばれます。ツールを使うたびに勇者がスキル攻撃します（`PostToolUse`＝技名がツール名（整形：PascalCase、MCP はサーバ名）のスキル攻撃。`PreToolUse` は攻撃せず、エンカウント出現／精霊増援／前進のみ）。敵を倒すと探索に戻ります。待機中は街、作業中はフィールドを探検、エンカウントの敵が画面にいる間だけ戦闘になります。

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

一番簡単なのは **AI コーディングエージェントに頼む**ことです。Claude Code か Codex にこう言ってください：

> **https://github.com/kitepon-rgb/rpgdev を見て RPGDev をインストールして。**

エージェントが [docs/agent-install.md](docs/agent-install.md) に従って、パッケージ導入・フックの**安全な自動書込**（バックアップ＋アトミック＋冪等＝既存設定を壊さない）・Windows/WSL2 のファイアウォール許可・窓の起動まで行います。スクリプトが自動でやり、**管理者が要る1手（WSL2 のときの Windows 側ファイアウォール）だけ**あなたに頼みます。

自分でやる場合:

```bash
npm install -g rpgdev
rpgdev setup --apply        # フックを安全に書込（無理なら書かずに表示へフォールバック）
rpgdev setup-firewall       # Windows/WSL2 のみ・Windows 側で実行
rpgdev setup-shortcut       # Windows/WSL2 のみ・スタートメニューに登録（Aqua の顔アイコン）
rpgdev                      # 窓を開く
```

`rpgdev help` でオプション（`--codex` / `--all` / `--user` …）を確認できます。

Requirements:

- Node.js 20+（全プラットフォーム共通）
- **macOS** — Swift compiler / Xcode Command Line Tools（窓は `swiftc` で必要時コンパイル）
- **Windows** — WebView2 ランタイム（Windows 11 標準）＋ .NET Framework 4.x の `csc.exe`（窓は C# WinForms+WebView2 を必要時コンパイル）。WebView2 SDK DLL は同梱済み（追加 DL 不要）。詳細は [docs/windows-wsl.md](docs/windows-wsl.md)
- **WSL2** — ハブ（サーバ）も窓も Windows ホスト側で動き（interop 起動）、WSL2 は単一の共有ハブへ接続。ホストに Node＋WebView2 と、WSL→ホスト inbound を許すホスト側ファイアウォール許可（`rpgdev setup-firewall` が標準 Defender＋Hyper-V の両層を適用）が必要（`localhostForwarding` は不要に）。詳細は [docs/windows-wsl.md](docs/windows-wsl.md)
- **素の Linux** — デスクトップ窓は未対応。ブラウザ表示（`npm run web`）を使用

## Start

```bash
rpgdev
```

デスクトップ右上に小さい RPGDev ウィンドウが開きます（macOS / Windows。WSL2 では Windows ホスト側に表示）。状態やログは、実行したプロジェクトの `.rpgdev/` に保存されます。Windows/WSL2 のセットアップは [docs/windows-wsl.md](docs/windows-wsl.md) を参照。

**Windows / WSL2 では、窓と一緒にタスクトレイ常駐（Aqua の顔アイコン）も起動します。** これはハブ（サーバ）が動いている目印で、アイコンがあれば稼働中・消えていれば停止です（新しいトレイアイコンは Windows 既定では `^` のあふれメニューに隠れます）。右クリックから「窓を開く」「街に戻る」「終了（ハブを停止）」ができます。

Web 版だけを開きたい場合:

```bash
rpgdev-server --open
```

表示: `http://127.0.0.1:37373/`

## Hooks

RPGDev は Hook イベントで動くので、お使いの AI エージェントに `rpgdev-hook` を呼ぶ設定を入れます。

**一番かんたん — AI エージェントに任せる。** すでに開いているエージェントにこう頼むだけ:

> RPGDev のフックを設定して（`node_modules/rpgdev/docs/install-hooks.md` に従って）。

エージェントが `rpgdev setup` を実行して、この端末向けの正しい設定を取得し、**既存設定を壊さずに**マージします。
RPGDev 自身は設定ファイルを書き換えません——適用はあなたのエージェントが目の前で行います。手順書:
[docs/install-hooks.md](docs/install-hooks.md)。

**手動でやる場合。** `rpgdev setup`（Codex は `--codex` / 両対応は `--all`、パソコン全体は `--user`）を実行し、
表示された JSON を**表示されたパスにそのまま**コピーします。書き込み先はスコープで変わります：プロジェクト用は
`.claude/settings.local.json`、パソコン全体（`--user`）の Claude は `~/.claude/settings.json`（ユーザー全体の
`settings.local.json` は Claude Code に読まれません）。正しいパスは `rpgdev setup` が表示します:

```bash
rpgdev setup            # Claude Code 用の設定と置き場所を表示
rpgdev setup --all      # Claude Code と Codex の両方
```

表示される設定は node 実体＋同梱フックスクリプトの絶対パスで呼ぶ形なので、macOS / Windows / WSL2 のどれでも動きます
（PATH や `.cmd` シムの罠なし）。

> **サンプル設定:** [`examples/`](examples/) に手動コピー用の静的サンプルがあります（グローバル導入が前提）。
> より堅牢な絶対パス形式を書く `rpgdev setup` の利用を推奨します。

Codex / Claude Code 側で project-local hooks の trust / review が必要な場合があります。新しく足したフックは
**新しいセッションで反映**されます（実行中セッションは再起動が必要なことがあります）。

## Hook Flow

- `UserPromptSubmit`: 冒険開始、ウィンドウを開く、フィールドへ
- `PreToolUse`: 20% でモンスターのエンカウント出現判定、戦闘中なら 20% で精霊の増援判定、出なければ前進（**攻撃はしない＝勇者の通常攻撃は廃止**。攻撃は `PostToolUse` のスキル攻撃だけ）
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
- モンスター（草原）: `public/assets/sprites/slime.png`, `goblin.png`, `orc.png`, `ogre.png`
  （洞窟）: `skeleton.png`, `ghoul.png`, `witch.png`, `grim-reaper.png`, `succubus.png`
  （城）: `dullahan.png`, `dragon.png`, `demon-lord.png`, `dark-mage.png`, `wolf-beastwoman.png`, `dark-knight.png`
- 仲間精霊: `public/assets/sprites/ally-fire.png`, `ally-earth.png`, `ally-wind.png`, `ally-water-facing-slit.png`
  （残ライフ3以下では `ally-fire-damaged.png`, `ally-earth-damaged.png`, `ally-water-damaged.png`, `ally-wind-damaged.png` に差し替え）
  （水精霊の別案として `ally-water.png`, `ally-water-facing.png` も同梱）
- BGM: `public/audio/field.wav`, `adventure.wav`, `battle.wav`, `dungeon-adventure.wav`, `dungeon-battle.wav`, `castle-adventure.wav`, `castle-battle.wav`
- 効果音: `public/audio/monster-appear.wav`, `public/audio/monster-defeat.wav`, `hero-normal-attack.wav`, `hero-skill-attack.wav`, `hero-finisher-attack.wav`, `ally-fire-attack.wav`, `ally-earth-attack.wav`, `ally-wind-attack.wav`, `ally-water-attack.wav`, `ally-return.wav`（精霊が撃破後に1体ずつ帰還する音）, `damage-hit.wav`（勇者/精霊がモンスターの反撃を受けた時の被ダメージ音）
- フォント: `public/fonts/cinzel.woff2`（全画面トランジションのタイトル文字。自己ホスト・OFL）

BGM は既存曲のメロディを使わないオリジナルのクラシック JRPG 調シーケンスで、冒険ステージ（草原 / 洞窟 / 城）×
探索・戦闘の7トラックを `scripts/render-bgm.mjs` から生成します（洞窟は不穏で低速、城は荘厳な行進調）。
攻撃効果音は `scripts/render-sfx.mjs` から生成します。`monster-appear.wav` / `monster-defeat.wav` は render-bgm/render-sfx 管轄外の別アセットで、`npm run render:bgm` では再生成されません。

デスクトップウィンドウは WebView（macOS は WKWebView、Windows/WSL2 は WebView2）なので、CSS/画像/JS を
更新した後に既存ウィンドウへ反映されない時はウィンドウを開き直してください。

## Development

```bash
npm test
npm run render:bgm        # BGM(7トラック)を再生成
npm run render:sfx        # 攻撃/帰還の効果音を再生成
npm run build:desktop     # デスクトップ窓のコンパイル（macOS=Swift / Windows・WSL2=C#）
npm run trace             # 演出トレース解析（.rpgdev/ のログから二連続/欠落/取りこぼしを検出）
```

`.rpgdev/` には現在の状態（`state.json`）に加え、演出の診断ログ（`events.ndjson`＝reducer の emit、`playback.ndjson`＝
ウィンドウが実際に再生/取りこぼした演出。各レコードに由来 Hook が付く）が残ります。`npm run trace` で突き合わせて解析できます。

## License

MIT
