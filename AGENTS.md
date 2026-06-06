# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## 概要

RPGDev は Codex / Claude Code の Hook イベントを、小さな RPG 風 macOS デスクトップ
ウィンドウの演出に変換するツール。モンスターはツール使用ごとに一定確率で出現する
**ランダムエンカウント**で、ツール利用が攻撃になる。撃破条件は出現時に紐づいた TODO の
有無で変わる（攻撃5回／ターン終了で討伐、または紐づき TODO の完了で討伐）。TODO は
クエスト一覧として表示しつつ、紐づきエンカウントの討伐トリガーにもなる。
macOS 専用、Node 20+、全体が ESM
(`"type": "module"`)。JS のビルド/バンドル工程はなく、TypeScript も使っていない。

## RPGDev 固有の検証ルール

RPGDev は macOS デスクトップアプリ / overlay アプリであり、ブラウザアプリではない。
ユーザーが明示的に依頼しない限り、Browser プラグイン、Playwright、ブラウザ表示確認、
`npm run web` を検証の主経路にしない。UI確認が必要な場合は `npm start`、
`npm run build:desktop`、`npm run server` + RPGDev overlay / デスクトップウィンドウ、
または reducer テストと demo Hook の流れで確認する。`/` のフル Web ビューは補助ビューであり、
RPGDev の本体として勝手に扱わない。

## コマンド

```bash
npm test                              # node:test の全テストを実行
node --test test/adventure-state.test.mjs   # 単一テストファイルを実行
node --test --test-name-pattern "spawns a monster"  # 名前で単一テストを実行

npm run server                        # HTTP サーバのみ起動（ウィンドウなし）
npm run web                           # サーバ起動 + ブラウザでフル Web ビューを開く
npm start                             # ビルド + macOS デスクトップウィンドウを起動
npm run build:desktop                 # Swift ウィンドウのコンパイルのみ（起動しない）
npm run render:bgm                    # public/audio/*.wav を再生成
npm run demo                          # 起動中のサーバに対して擬似 Hook シーケンスを流す
```

`npm run demo` は事前にサーバが起動している必要がある（`rpgdev` / `npm run server`）。

## リリース（npm publish）

詳細は [docs/releasing.md](docs/releasing.md)。要点だけ：

- **rpgdev は npm 公開済み**（2026-06-05 に v0.1.0 初公開）。**2回目以降の更新は granular automation トークン（bypass 2FA）で publish できる**＝バージョンを上げて `npm publish --access public` だけ。OTP 不要。
- Claude に publish させるには `.claude/settings.local.json` の `permissions.allow` に `Bash(npm publish:*)` が必要（gitignore 対象なので無ければ足す）。`cd && npm publish` の複合だと許可パターンに当たらないので、`npm publish <repo path> --access public` の形で叩く。
- **罠（もう再発しないが知っておく）**：npm の granular トークンは「まだ存在しないパッケージ」を作れない。**新規パッケージの初回 publish だけは対話 `npm login` + OTP が必須**（granular だと PUT 404、whoami 401）。既存パッケージの更新では起きない。トークンを何度替えても初回作成は通らないので、新規 publish で 404 が出たら token を疑う前に「初回は OTP」を思い出すこと。

## 現行ゲームモデル（重要）

ゲームモデルは「TODO 項目＝モンスター」ではなく「**モンスター＝ランダムエンカウント**」。
モンスターは TODO 項目から湧かない。ツール使用ごと（PreToolUse）に 20% の確率で出現する
エンカウントで、同時に画面へ出るのは最大1体（2体同時出現はしない）。スプライト/HP は
`MONSTER_CATALOG`（Slime/Goblin/Orc/Ogre）からランダムに選ぶ（HP は演出専用）。`battle`
フェーズになるのは「エンカウントのモンスターが画面に居る時」だけで、TODO があるだけでは
戦闘にならない。

各エンカウントは出現時の状況で `linkedTodo` フラグを持ち、討伐条件が変わる：
- `linkedTodo=false`（出現時に in_progress の TODO 無し）：hero の攻撃 5回、または
  ターン終了（Stop）で討伐。
- `linkedTodo=true`（出現時に in_progress の TODO あり）：攻撃では倒れない。TODO 項目が
  1つ `completed` になった時に討伐する。in_progress TODO が無くなると `linkedTodo` は解除され、
  以後は5撃／ターン終了で倒せるようになる。

TODO（TodoWrite / update_plan）は state.quest（label+status+stage のスナップショット、元の順序）を
更新するだけでモンスターは湧かさない。新たに `completed` になった項目があれば、紐づく
（linkedTodo）エンカウントの討伐トリガーになる。**TODO 未発生の間は、UserPromptSubmit の
ユーザー入力を1つの合成クエスト（`synthetic:true`, in_progress）として表示**し、TodoWrite が
来たら本物の TODO に置き換える（synthetic は表示専用で linkedTodo には数えない）。

**冒険ステージ（field → dungeon → castle）**：phase とは別に「場所」を表す `adventureStage` を持つ。
TODO 一覧を元の順序のまま3区画へ均等割りし（端数は field 側を厚く）、各項目に `stage` を付与する。
現在地は最初の未完了 TODO のステージで、completed が進むほど奥（dungeon→castle）へ進む。
背景画像（field/dungeon/castle.png）と BGM トラックがステージで切り替わる。TODO 不在は常に field。
ステージは演出専用で、討伐条件やエンカウント確率には影響しない。詳細は docs §2.1。

**1つの Hook では1アクションだけ**（出現／召喚／攻撃／前進のいずれか1つ）。出現→攻撃→召喚を
同一 Hook で連鎖させない。攻撃・増援召喚は敵が居なければ起きない。

精霊（仲間 allies）：戦闘中はツール使用ごと（PreToolUse）に 10% で1体だけ増援し、
`SubagentStart` でも1体参戦する。常に1体ずつで属性の重複を避け（火 Ignis / 地 Terra /
風 Sylph / 水 Aqua）、上限4体。**PostToolUse（スキル攻撃）の時だけ**現在の敵に追撃する
（演出のみで討伐の5撃にはカウントしない。effect に `allyElement` が付き、属性別エフェクトを出す）。
モンスターを倒すたびに精霊は全員消滅し、`SubagentStop` で1体ずつ FIFO（最初に出た精霊から）帰還する。
`Aqua` は水精霊スプライト `ally-water-facing-slit.png` を使う。

設計判断・Codex/Claude のフック実機検証結果・実装ステータスは
[docs/design-todo-rpg.md](docs/design-todo-rpg.md) が単一の正典。reducer に手を入れる前に必ず読む。
reducer ([server/adventure-state.mjs](server/adventure-state.mjs)) と
そのテスト ([test/adventure-state.test.mjs](test/adventure-state.test.mjs)) は実装済み。
フロントエンド（[public/overlay.js](public/overlay.js) / [public/app.js](public/app.js)）も
state / effect に配線済み。overlay には精霊スプライト、斬撃、技名カットイン、揺れ、
召喚/属性別追撃演出、ステージ別背景、出現（ポータル+煙）/撃破（発光+破片）アニメと効果音
（`monster-appear.wav` / `monster-defeat.wav`）があり、攻撃/リアクションのアニメは全体共通の
単一キューで直列化される（攻撃は固定1秒間隔、その他はアニメ目安+0.1秒で次へ。出現/召喚/帰還/
クリア等の即時演出はキューを占有しない。撃破中はワールド演出を約1.8秒保留して撃破を見せる）。
仲間精霊は `Ignis` / `Terra` / `Sylph` / `Aqua` の4体。
docs §8 の宿題（Codex 非Bash失敗フィールド、Claude TodoWrite payload、TODO無しセッション方針）は全て検証・決定済み。

## アーキテクチャ

システム全体は **一方向のパイプライン**: Hook イベント → reducer → 永続化された
状態 → SSE ブロードキャスト → UI。

1. **Hook CLI** ([scripts/rpg-hook.mjs](scripts/rpg-hook.mjs)、`rpgdev-hook <provider> <event>` として公開)
   は Hook ペイロードを JSON として stdin から読み、サーバの起動を確認し、
   `{provider, event, raw, at}` を `/hook` に POST する。`UserPromptSubmit` の時は
   デスクトップウィンドウも起動する。

2. **サーバ** ([server/rpgdev-server.mjs](server/rpgdev-server.mjs)) は依存ゼロの
   `node:http` サーバ。`/hook` で reducer を実行し、永続化してブロードキャストする。
   静的フロントエンドの配信に加え、`/state`、`/events`（SSE）、`/health`、
   `/control/reset`、`/control/demo` を公開する。

3. **Reducer / 状態機械** ([server/adventure-state.mjs](server/adventure-state.mjs))
   がアプリの心臓部であり、**唯一のユニットテスト対象モジュール**。純粋関数:
   `reduceHookEvent(prevState, hookEvent) → { state, effects, normalized }`。I/O なし。
   - `normalizeHookEvent` は Codex/Claude の多様なペイロード形状
     （`hook_event_name`、`tool_input.command` など）を 1 つの正規化イベントに平坦化する。
   - `detectFailure` は Claude の失敗イベント名と構造化された失敗/exit-code フィールドだけを見る。
     出力テキストの `error` 単語マッチは偽陽性が多いため廃止済み。
   - フェーズ: `idle → field → battle → complete`。冒険ステージ `adventureStage`（field/dungeon/castle）
     ＝最初の未完了 TODO のステージで、`trackForState` がステージ×phase で7種の BGM トラックを選ぶ
     （`field` / `adventure` / `battle` / `dungeon-adventure` / `dungeon-battle` / `castle-adventure` / `castle-battle`）。
   - モンスターはランダムエンカウント：PreToolUse ごとに 20% で出現し（同時最大1体）、
     `MONSTER_CATALOG`（Slime/Goblin/Orc/Ogre）から sprite/HP をランダムに選ぶ。HP は演出専用。
     TodoWrite/update_plan はモンスターを湧かさず、state.quest を更新する（各項目に field/dungeon/castle の `stage` を割り当て）だけ。
   - 討伐は出現時に決まる `linkedTodo` で分岐：`linkedTodo=false` なら攻撃5回または
     ターン終了(Stop)、`linkedTodo=true` なら攻撃では倒れず TODO 項目が `completed` に
     なった時のみ討伐（in_progress TODO が消えると linkedTodo は解除）。
   - 攻撃/増援判定：PreToolUse は通常攻撃に加えて 20% エンカウント出現判定と、戦闘中は
     10% 精霊増援判定を行う（1ツール呼び出し1回）。PostToolUse はスキル攻撃（技名＝コマンド要約 or
     ツール名）のみで出現・増援判定はせず、在席精霊の追撃はこの PostToolUse 時のみ。
     `SubagentStart` でも精霊1体参戦、`SubagentStop` で FIFO 帰還（最初に出た精霊から）。
   ここの挙動を変えたら [test/adventure-state.test.mjs](test/adventure-state.test.mjs) を更新すること。

4. **デスクトップウィンドウ** ([scripts/desktop.mjs](scripts/desktop.mjs) + [desktop/RPGDevWindow.swift](desktop/RPGDevWindow.swift))。
   `desktop.mjs` は Swift ソースを `swiftc` でオンデマンドにコンパイルし（ソースの mtime が
   バイナリより新しい時のみ再ビルド）、`.rpgdev/RPGDev.app` を生成して `/overlay.html` を
   指して `open` する。Swift アプリはボーダーレスな `WKWebView`（`LSUIElement`/アクセサリ
   アプリ）で、`window.webkit.messageHandlers.rpgdev` の JS↔Swift ブリッジ経由で音声を
   ネイティブ再生する（7種の BGM トラックをループ再生し、`sfx` メッセージで `monster-appear` /
   `monster-defeat` を `AVAudioPlayer` でワンショット再生）。

5. **2 つのフロントエンド、1 つのサーバ:**
   - `/` → [public/index.html](public/index.html) + [public/app.js](public/app.js) — フル Web ビュー。
   - `/overlay.html` → [public/overlay.js](public/overlay.js) — Swift WebView 内で読み込む
     コンパクトなウィンドウ UI。ネイティブブリッジが無い時はページ内 WebAudio に
     フォールバックする。
   どちらも `/events` を `EventSource` で購読し、`effects` 配列に反応するだけで、
   ゲームロジック自体は計算しない —— サーバが唯一の信頼できる情報源。

## 状態・永続化・設定

- 実行時の状態はすべて **プロジェクト単位** で `<PROJECT_DIR>/.rpgdev/` 配下に書かれる:
  `state.json`（現在の状態、起動時に読み込む）、`events.ndjson`（追記専用イベントログ）、
  `*-errors.log`。`.rpgdev/` は gitignore 済み。
- `PROJECT_DIR` は既定で `process.cwd()`。`RPGDEV_PROJECT_DIR` 環境変数経由で起動した
  子プロセスに伝播されるので、3 つのエントリポイントすべてが読み書き先で一致する。
- 環境変数: `RPGDEV_PORT`（既定 37373）、`RPGDEV_HOST`（既定 127.0.0.1）、
  `RPGDEV_PROJECT_DIR`。
- `bin/rpgdev`、`bin/rpgdev-hook`、`bin/rpgdev-server` は対応する `scripts/`/`server/`
  モジュールを import するだけの薄いラッパー。

## 維持すべき規約

- **静かなフォールバックをしない。** Hook CLI は失敗を `.rpgdev/hook-errors.log` + stderr に
  記録し、成功を装わずに非ゼロ終了する。サーバは `.rpgdev/server-errors.log` に記録する。
  編集時もこの挙動を維持し、エラーを握りつぶさないこと。
- サーバと reducer は **npm 依存ゼロ**。stdlib のみを保つこと。
- BGM（`field` / `adventure` / `battle` / `dungeon-*` / `castle-*` の7トラック）は
  [scripts/render-bgm.mjs](scripts/render-bgm.mjs) で生成される（既存曲を使わないオリジナルの
  クラシック JRPG 調シーケンスを WAV に合成。決定的で乱数なし）。ジェネレータを編集してから
  `npm run render:bgm` を実行すること。BGM の WAV を直接編集しない。
  - 例外：`public/audio/monster-appear.wav` / `monster-defeat.wav` は render-bgm 管轄外の
    効果音アセット（ジェネレータでは生成しない別ファイル）。`npm run render:bgm` では再生成されない。

## Hook の組み込み（ツール利用者向け）

設定例は [examples/](examples/) にある: `claude-settings.local.json` →
`.claude/settings.local.json`、`codex-hooks.json` → `.codex/hooks.json`。呼び出しスタイルの
違いに注意: Claude は provider/event を `args` 配列で渡し、Codex は `command` 文字列に
インラインで書く（`rpgdev-hook codex PreToolUse`）。
