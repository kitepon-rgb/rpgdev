# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

RPGDev は Codex / Claude Code の Hook イベントを、小さな RPG 風 macOS デスクトップ
ウィンドウの演出に変換するツール。エラーでモンスターが出現し、解決ステップでダメージを
与え、撃破するとフィールドが回復する。macOS 専用、Node 20+、全体が ESM
(`"type": "module"`)。JS のビルド/バンドル工程はなく、TypeScript も使っていない。

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

## 再設計中（重要）

ゲームモデルを「エラー＝モンスター」から「**TODO 項目＝モンスター**」へ作り直している。
設計判断・Codex/Claude のフック実機検証結果・未着手の宿題は
[docs/design-todo-rpg.md](docs/design-todo-rpg.md) が単一の正典。reducer に手を入れる前に必ず読む。
reducer ([server/adventure-state.mjs](server/adventure-state.mjs)) と
そのテスト ([test/adventure-state.test.mjs](test/adventure-state.test.mjs)) は新モデルへ移行済み。
フロントエンド（[public/overlay.js](public/overlay.js) / [public/app.js](public/app.js)）も
新 state / effect に配線済み（ビジュアルは仮。画像・凝った演出は未着手）。
docs §8 の宿題（Codex 非Bash失敗フィールド、Claude TodoWrite payload、TODO無しセッション方針）は全て検証・決定済み。
残るのは画像/演出（Codex 側）と、ウィンドウ実起動での目視確認のみ。

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
   - `detectFailure` はヒューリスティック（イベント名のサフィックス、error/exit-code
     フィールド、stderr/出力テキストの正規表現）で、`PostToolUse` がモンスターを
     出現させるかを判定する。
   - フェーズ: `idle → field → battle → complete`。BGM トラック: `field / adventure / battle`。
     モンスターは `MONSTER_CATALOG` から tool/summary テキストのキーワードで選ばれる。
     同一の失敗が繰り返されると、新しいモンスターを追加するのではなく既存個体を
     「enrage（強化）」させる。
   ここの挙動を変えたら [test/adventure-state.test.mjs](test/adventure-state.test.mjs) を更新すること。

4. **デスクトップウィンドウ** ([scripts/desktop.mjs](scripts/desktop.mjs) + [desktop/RPGDevWindow.swift](desktop/RPGDevWindow.swift))。
   `desktop.mjs` は Swift ソースを `swiftc` でオンデマンドにコンパイルし（ソースの mtime が
   バイナリより新しい時のみ再ビルド）、`.rpgdev/RPGDev.app` を生成して `/overlay.html` を
   指して `open` する。Swift アプリはボーダーレスな `WKWebView`（`LSUIElement`/アクセサリ
   アプリ）で、`window.webkit.messageHandlers.rpgdev` の JS↔Swift ブリッジ経由で音声を
   ネイティブ再生する。

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
- `public/audio/*.wav` の BGM は [scripts/render-bgm.mjs](scripts/render-bgm.mjs) で生成される
  （既存曲を使わないオリジナルのクラシック JRPG 調シーケンスを WAV に合成）。ジェネレータを
  編集してから `npm run render:bgm` を実行すること。WAV を直接編集しない。

## Hook の組み込み（ツール利用者向け）

設定例は [examples/](examples/) にある: `claude-settings.local.json` →
`.claude/settings.local.json`、`codex-hooks.json` → `.codex/hooks.json`。呼び出しスタイルの
違いに注意: Claude は provider/event を `args` 配列で渡し、Codex は `command` 文字列に
インラインで書く（`rpgdev-hook codex PreToolUse`）。
