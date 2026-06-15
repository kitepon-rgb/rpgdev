# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## 概要

RPGDev は Codex / Claude Code の Hook イベントを、小さな RPG 風 macOS デスクトップ
ウィンドウの演出に変換するツール。モンスターはツール使用ごとに一定確率で出現する
**ランダムエンカウント**で、ツール利用が攻撃になる。撃破条件は出現時に紐づいた TODO の
有無で変わる（紐づき無しは攻撃5回／ターン終了で討伐、紐づき有りは TODO 完了／ターン終了で討伐）。TODO は
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
エンカウントで、同時に画面へ出るのは最大1体（2体同時出現はしない）。スプライト/HP/反撃種別は
ステージ別 `MONSTER_CATALOGS` からランダムに選ぶ（HP は演出専用）。`battle`
フェーズになるのは「エンカウントのモンスターが画面に居る時」だけで、TODO があるだけでは
戦闘にならない。出現カタログは冒険ステージ別で、field は既存4体、dungeon/castle は各ステージ専用モンスターから
ランダムに選ぶ。castle の Dragon / Demon Lord は TODO が4個以上あり、最後の TODO が現在地の時だけ抽選に入る。

各エンカウントは出現時の状況で `linkedTodo` フラグを持ち、討伐条件が変わる：
- `linkedTodo=false`（出現時に in_progress の TODO 無し）：hero の攻撃 5回、または
  ターン終了（Stop）で討伐。
- `linkedTodo=true`（出現時に in_progress の TODO あり）：攻撃では倒れない。TODO 項目が
  1つ `completed` になった時、またはターン終了（Stop）で討伐する。in_progress TODO が無くなると
  `linkedTodo` は解除され、以後は5撃／ターン終了で倒せるようになる。Stop は TODO status の
  整理漏れが残っても戦闘を次ターンへ持ち越さない最終クリーンアップ。

TODO（TodoWrite / update_plan）は state.quest（label+status+stage のスナップショット、元の順序）を
更新するだけでモンスターは湧かさない。新たに `completed` になった項目があれば、紐づく
（linkedTodo）エンカウントの討伐トリガーになる。**TODO 未発生の間は、UserPromptSubmit の
ユーザー入力を1つの合成クエスト（`synthetic:true`, in_progress）として表示**し、TodoWrite が
来たら本物の TODO に置き換える（synthetic は表示専用で linkedTodo には数えない）。

**冒険ステージ（field → dungeon → castle）**：phase とは別に「場所」を表す `adventureStage` を持つ。
TODO 一覧を元の順序のまま3区画へ均等割りし（端数は field 側を厚く）、各項目に `stage` を付与する。
現在地は最初の未完了 TODO のステージで、completed が進むほど奥（dungeon→castle）へ進む。
背景画像（field/dungeon/castle.png）と BGM トラックがステージで切り替わる。TODO 不在は常に field。
ステージは背景/BGMと出現カタログに影響するが、討伐条件やエンカウント確率には影響しない。詳細は docs §2.1。

**1つの Hook では1アクションだけ**（出現／召喚／攻撃／前進のいずれか1つ）。出現→攻撃→召喚を
同一 Hook で連鎖させない。攻撃・増援召喚は敵が居なければ起きない。

精霊（仲間 allies）：戦闘中はツール使用ごと（PreToolUse）に 10% で1体だけ増援し、
`SubagentStart` でも1体参戦する。常に1体ずつで属性の重複を避け（火 Ignis / 地 Terra /
風 Sylph / 水 Aqua）、上限4体。**PostToolUse（スキル攻撃）の時だけ**現在の敵に追撃する
（演出のみで討伐の5撃にはカウントしない。effect に `allyElement` が付き、属性別エフェクトを出す）。
モンスターを倒すたびに精霊は全員消滅し、`SubagentStop` で1体ずつ FIFO（最初に出た精霊から）帰還する。
`Aqua` は水精霊スプライト `ally-water-facing-slit.png` を使う。

### 精霊・キャラクター画像生成の最重要ルール

**このゲームで精霊・キャラクター画像を生成/再生成/編集する時は、次の語句を必ずプロンプトへ入れる。省略禁止。**

`retro RPG / pixel art / old JRPG sprite / limited palette / chunky pixel clusters`

この語句は火・土・水・風を同じゲーム内ドット粒度へ寄せるための最重要指定であり、
`current 2020s Japanese 2D anime / VTuber idol / mobile gacha RPG art` などの美麗アニメ指定より優先する。
これを抜くと風 Sylph のように高解像度イラスト調へズレる。次回以降、精霊画像では必ず入れる。

画像の生成・編集経路（2026-06-15 更新）：

- **StableDiffusion 系 MCP は使わない。** `comfy-sd` / `sd-pipeline` / `sd_*` / `advisor_*` は削除済みで、
  RPGDev の精霊画像作業では使用禁止。使おうとせず、必要ならこの節を根拠に停止して報告する。
- 採用済みの火 Ignis / 土 Terra / 水 Aqua / 風 Sylph damaged 画像は StableDiffusion ではない。過去ログで確認済みの手順は
  **Codex 内蔵 `image_gen` でクロマキー背景つき候補を作る → Pillow で背景を alpha 化 →
  配置・高さ合わせを機械的に確認 → `view_image` で比較確認 → 採用ファイルへコピー**。
- **手作業による画像加工は永久禁止。** 過去ログ上、Pillow 等で布・肌・輪郭を描き足す/削る/合成する
  手作業加工は成功していない。禁止対象は、局所ペイント、衣装や肌の合成、手描きの破れ追加、
  肌クリーンアップ、アウトラインの後付け、色を塗って見た目を直す処理。失敗候補を手作業で救済しない。
  許可されるローカル処理は、背景の alpha 化、キャンバス/アスペクト比/サイズ合わせ、bbox/高さの測定、
  チェック背景や比較画像の作成など、画像内容を創作・改変しない機械的処理だけ。
- ダメージ差分で表示位置を守る時は、採用中の通常版画像を基準に、キャンバスサイズ・有効 bbox・高さを
  機械的に比較して合わせる。AI 生成結果をそのまま採用しない。
- 透過処理では、生成時にキャラ色と衝突しない単色クロマキー背景を指定し、背景色をキャラやエフェクト内で使わせない。
  風 Sylph は紫・薄紫の衣装/風エフェクトを含むため、濃い紫ではなく濃いピンク `#ff00cc` を使う。
  その後、Pillow の色判定・外周/接続成分・小穴補正で alpha を作る。濃いピンク背景では閉じた穴の背景も残るので、
  `#ff00cc` 系の島だけを追加で抜く。黒背景/黒影の透過漏れ検査は必須：
  `alpha > 24` かつ `r,g,b < 28` のピクセル数を確認し、チェック背景に合成して目視
  （水 Aqua では採用版に黒背景が 20万px 以上残っていた前例）。
- 生成プロンプトには、元絵と同じ太い暗色アウトラインを維持する指定を入れる。
  例：`preserve the original sprite's thick dark readable outline weight` / `bold sprite contour`。
  `thin delicate line art` / `hairline outline` は明示的に禁止する。輪郭が細い候補は手作業で直さず、再生成で直す。
- 出力サイズが違う場合は、元画像のアスペクト比へ中央クロップまたは元キャンバスサイズへリサイズする。
  採用前に通常版との bbox/高さ/位置比較画像を作る。
- 風 Sylph の damaged 画像を作る場合、他の風画像候補は腰位置がずれた失敗作として扱う。
  **基準画像は現在ゲームで採用中の `public/assets/sprites/ally-wind.png` だけ**。
- 採用前に `view_image` または実アプリ表示で確認し、採用後だけ `public/assets/sprites/ally-*.png` へ配置する。
- 採用後はアプリ側の画像キャッシュを疑う。overlay の精霊画像 URL は cache bust 付き
  （`SPRITE_CACHE_BUSTER`）で読み、古い画像を見ていない状態で確認する。
- ツールが失敗した場合、別方式に黙ってフォールバックしない。エラー全文、対象画像の絶対パス、
  生成・後処理のどの段階で失敗したかを明示する。

既存精霊の再生成/調整プロンプトテンプレート：
```text
Edit the currently shown [element] spirit image as the direct base image.

Preserve the original artwork as much as possible: same canvas/framing, same pose, same silhouette, same face direction, same hair shape, same character identity, same fantasy battle costume design, same ornaments/effects, same transparent-looking background. Do not redraw her as a different character and do not change non-target areas.

Required style goals, do not omit: retro RPG / pixel art / old JRPG sprite / limited palette / chunky pixel clusters.

Make this exact artwork read like an old JRPG battle ally sprite: crisp pixel-art-like edges, visible chunky pixel clusters, hard cel-shaded color blocks, reduced smooth gradients, limited palette per material, small stepped highlight/shadow bands at final sprite scale, strong readable outline. Match the rough dot size and sprite-like texture of the existing RPGDev Ignis, Terra, Aqua, and Sylph spirit sprites.

Apply only this local change: [specific requested edit]. No soot, no dirt, no battle damage unless explicitly requested. No chibi transformation, no tiny 8-bit icon simplification, no pose change, no character redesign, no text, no watermark, no extra characters.
```

風 Sylph 採用版の基準プロンプト（既存画像のドット粒度合わせ）：
```text
Edit the currently shown wind spirit image as the direct base image.

Preserve the original artwork as much as possible: same canvas/framing, same horizontal flying pose, same silhouette, same face direction, same mint-green hair shape, same character identity, same fantasy battle costume, same jewelry/feathers, same wind ribbons, same black/transparent-looking background. Do not redraw her as a different character and do not change the outfit design.

The required style correction is pixel/dot granularity. Apply these exact style goals: retro RPG / pixel art / old JRPG sprite / limited palette / chunky pixel clusters.

Make this exact artwork read like an old JRPG battle ally sprite: crisp pixel-art-like edges, visible chunky pixel clusters, hard cel-shaded color blocks, reduced smooth gradients, limited palette per material, small stepped highlight/shadow bands at final sprite scale, strong readable outline. Match the rough dot size and sprite-like texture of the existing RPGDev Ignis, Terra, and Aqua spirit sprites.

Keep the detailed anime JRPG spirit design, but remove the overly smooth high-resolution illustration finish. No chibi transformation, no tiny 8-bit icon simplification, no pose change, no character redesign, no text, no watermark, no extra characters.
```

新規キャラクターをゼロから作る場合も、上記の必須語句を入れたうえで `game ally sprite source`,
`full body centered with generous padding`, `3/4 rear-side view from behind-left`,
`facing right toward enemies`, `crop-friendly`, `crisp sprite-like outline` を指定する。
禁止方向は generic smooth anime への漂流、Western fantasy painting、photorealism、3D、vector、chibi、
front-facing fashion lineup、既存VTuber/版権キャラ模倣、ロゴ/文字/UI。

現時点の採用状態：
- `Aqua` は `public/assets/sprites/ally-water-facing-slit.png`。元 `ally-water-facing.png` の alpha を適用済み。
- 戦闘表示の `Aqua` は `public/overlay.css` の `.ally-water` で他より 1割大きめに表示する。
- `Sylph` は `public/assets/sprites/ally-wind.png`。上記の風 Sylph 採用プロンプトで再生成した retro/pixel 版。
- `Sylph` damaged は `public/assets/sprites/ally-wind-damaged.png`。2026-06-15 に候補 C/v39 相当を採用。通常版 `ally-wind.png`
  との位置差は頭中心 `+1.0px/+0.5px`、右足先中心 `-1.0px/+0.5px` で、同一 CSS 位置/倍率で表示できる。
- 精霊4体の配置確認は `/control/layout-spirits` を使う。`layoutPreview: true` の間は反撃ループを止め、
  確認中に精霊が被弾/帰還して消えないようにする。

**v0.5.0 追加（詳細は docs §13）**：①精霊は勇者スキル攻撃の後に在席全員がランダム順で追撃（フロント生成・脱Hook維持）。
②勇者＋全精霊が攻撃し切ってキューが空くと、モンスターが8秒おきに反撃（対象は勇者/在席精霊からランダム）＝被弾エフェクト＋`damage-hit` 音。
タイミングは実クロックを持つフロント駆動（reducer はタイマー非保持）。③各精霊は被弾5回で退場（`life`＝サーバー権威。フロントが
`POST /control/counter-hit {hitId,allyId}` で通知→`applyCounterHit` がライフ確定・`ally_hit`/`ally_defeated` を emit。
残ライフ3以下で被弾スプライトへ切替。現採用済みは火・土・水・風精霊で、
`ally-fire` + `life<=3` → `ally-fire-damaged.png`、`ally-earth` + `life<=3` → `ally-earth-damaged.png`、
`ally-water-facing-slit` + `life<=3` → `ally-water-damaged.png`、
`ally-wind` + `life<=3` → `ally-wind-damaged.png`
（同一キャンバス・同一CSS位置/倍率）。
④戦闘→探検の遷移は `#sceneTransition` の全画面トランジション（`title.png`＋自己ホスト Cinzel のテキストが右上→中央→左下）で
覆い、被覆ピークで背景/勇者を差替＝瞬間移動を隠す。⑤クエストはオーナーセッション限定（`ownerSession`/`isOwnerSession`。
**ロック中**のオーナーは素の UserPromptSubmit でも TODO でも奪われない＝作業中の乗っ取り防止）。**v0.5.3〜v0.5.4 で動的化**：オーナーがアイドル
（進行中の本物TODO・稼働サブエージェント/WFのいずれも無い）なら、別セッションが**素のメッセージでも TODO でも**オーナーを奪取してクエストを更新する（v0.5.4 で UserPromptSubmit も対称化＝クエスト単発が休眠オーナーに固定される問題を解消）。
ロック解除はアイドル化 or ターン終了（＝オーナーのStop限定。`subagentCounts` で稼働を数える。詳細は docs §15）。⑥`SubagentStart`/`SubagentStop`
フックを配線（reducer は元から対応・`examples/` の設定にも追加）。

設計判断・Codex/Claude のフック実機検証結果・実装ステータスは
[docs/design-todo-rpg.md](docs/design-todo-rpg.md) が単一の正典。reducer に手を入れる前に必ず読む。
reducer ([server/adventure-state.mjs](server/adventure-state.mjs)) と
そのテスト ([test/adventure-state.test.mjs](test/adventure-state.test.mjs)) は実装済み。
フロントエンド（[public/overlay.js](public/overlay.js) / [public/app.js](public/app.js)）も
state / effect に配線済み。overlay には精霊スプライト、斬撃、技名カットイン、揺れ、
召喚/属性別追撃演出、ステージ別背景、出現（ポータル+煙）/撃破（発光+破片）アニメと効果音
（`monster-appear.wav` / `monster-defeat.wav` / 攻撃SFX群）があり、攻撃/リアクションのアニメは全体共通の
単一キューで直列化される（勇者攻撃・精霊追撃・精霊召喚はすべて前のキュー再生開始から固定1秒間隔
＝前のキューが無ければ即座、その他はアニメ目安+0.1秒で次へ。モンスター出現の
演出開始から4秒間（`APPEAR_ATTACK_DELAY_MS=4000`）は攻撃/召喚キューを再生しない＝出現演出と直後の初撃/召喚を被らせない
（＝登場の4秒後に最初のキュー再生）。精霊召喚も攻撃キューと同じ扱いで、カード表示も召喚がキューで再生される瞬間まで
伏せる（`awaitingSummon`＝state更新で先にカードを出さない）。出現演出の
色変化 filter は終了時に通常状態へ戻し、WKWebView に色味を残留させない。出現/帰還/
クリア等の即時演出はキューを占有しない。撃破時は同じバッチ内でトドメに至った攻撃を捨てずに順に
流してから会心の一撃（`finisher`＝斬撃。技名テキストは出さず視覚演出のみ）→撃破＋消滅を流す。
撃破effectを含むバッチを受信した瞬間に過去バッチから溜まっていた攻撃キューを破棄し、`monster_defeated`
がキューに入った後の別バッチ攻撃は受け付けず、消滅演出開始時点でも残った攻撃キューを再度破棄する
（旧実装は撃破時に攻撃を破棄しており通常攻撃が欠落して見えた）。撃破effectを受信したらワールド演出を保留し、
実際に消滅演出を再生した後で次の背景/BGM/フェーズへ切り替える）。
勇者は常にモンスターより前面（`.hero` z-index > `.monster`）。仲間精霊は `Ignis` / `Terra` / `Sylph` / `Aqua` の4体。
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
     ステージ別 `MONSTER_CATALOGS` から sprite/HP/反撃種別をランダムに選ぶ。HP は演出専用。
     TodoWrite/update_plan はモンスターを湧かさず、state.quest を更新する（各項目に field/dungeon/castle の `stage` を割り当て）だけ。
   - 討伐は出現時に決まる `linkedTodo` で分岐：`linkedTodo=false` なら攻撃5回または
     ターン終了(Stop)、`linkedTodo=true` なら攻撃では倒れず TODO 項目が `completed` に
     なった時またはターン終了(Stop)で討伐（in_progress TODO が消えると linkedTodo は解除）。
   - 攻撃/増援判定：PreToolUse は通常攻撃に加えて 20% エンカウント出現判定と、戦闘中は
     10% 精霊増援判定を行う（1ツール呼び出し1回）。PostToolUse はスキル攻撃（技名＝tool_name 基準＝
     PascalCase / MCP はサーバ名。コマンド/パッチ本文は見ない＝apply_patch の「***」を回避）のみで
     出現・増援判定はせず、在席精霊の追撃はこの PostToolUse 時のみ。
     `SubagentStart` でも精霊1体参戦、`SubagentStop` で FIFO 帰還（最初に出た精霊から）。
   ここの挙動を変えたら [test/adventure-state.test.mjs](test/adventure-state.test.mjs) を更新すること。

4. **デスクトップウィンドウ** ([scripts/desktop.mjs](scripts/desktop.mjs) + [desktop/RPGDevWindow.swift](desktop/RPGDevWindow.swift))。
   `desktop.mjs` は Swift ソースを `swiftc` でオンデマンドにコンパイルし（ソースの mtime が
   バイナリより新しい時のみ再ビルド）、`.rpgdev/RPGDev.app` を生成して `/overlay.html` を
   指して `open` する。Swift アプリはボーダーレスな `WKWebView`（`LSUIElement`/アクセサリ
   アプリ）で、`window.webkit.messageHandlers.rpgdev` の JS↔Swift ブリッジ経由で音声を
   ネイティブ再生する（7種の BGM トラックをループ再生し、`sfx` メッセージで `monster-appear` /
   `monster-defeat` と攻撃SFXを `AVAudioPlayer` でワンショット再生）。ウィンドウの位置・サイズは終了/移動/
   リサイズ時に `UserDefaults` に保存し、次回起動で復元する（ディスプレイ構成が変わったら既定位置に
   リセット。`isRestorable=false` で macOS 自動復元と競合させず自前管理）。

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
  - 攻撃SFX（勇者通常/スキル/トドメ、精霊4属性）は [scripts/render-sfx.mjs](scripts/render-sfx.mjs)
    で生成される。編集後は `npm run render:sfx` を実行すること。
  - 例外：`public/audio/monster-appear.wav` / `monster-defeat.wav` は render-bgm/render-sfx 管轄外の
    効果音アセット（ジェネレータでは生成しない別ファイル）。`npm run render:bgm` では再生成されない。

## Hook の組み込み（ツール利用者向け）

設定例は [examples/](examples/) にある: `claude-settings.local.json` →
`.claude/settings.local.json`、`codex-hooks.json` → `.codex/hooks.json`。呼び出しスタイルの
違いに注意: Claude は provider/event を `args` 配列で渡し、Codex は `command` 文字列に
インラインで書く（`rpgdev-hook codex PreToolUse`）。
