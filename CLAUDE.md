# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

RPGDev は Codex / Claude Code の Hook イベントを、小さな RPG 風デスクトップ
ウィンドウの演出に変換するツール。モンスターはツール使用ごとに一定確率で出現する
**ランダムエンカウント**で、ツール利用が攻撃になる。撃破条件は出現時に紐づいた TODO の
有無で変わる（攻撃5回／ターン終了で討伐、または紐づき TODO の完了で討伐）。TODO は
クエスト一覧として表示しつつ、紐づきエンカウントの討伐トリガーにもなる。
macOS / Windows（WSL2 含む）対応、Node 20+、全体が ESM
(`"type": "module"`)。JS のビルド/バンドル工程はなく、TypeScript も使っていない。
デスクトップ窓だけがプラットフォーム依存（macOS=Swift+WKWebView / Windows=C# WinForms+WebView2 /
WSL2=Windows ホスト側に interop で同窓を起動 / 素の Linux は窓なし＝`npm run web`）。**Windows/WSL2 は
サーバ（ハブ）も窓も Windows ホスト上の単一インスタンスに集約**＝ハブ1つを Windows ローカルのファイルから起動して
`0.0.0.0` で待ち受け（窓は localhost 接続、WSL2 フックはホストの WSL アダプタ IP 経由）、Windows でも WSL2 でも同じ1つの
共有冒険を動かす（セットアップ順非依存。要：WSL→ホスト inbound を許可する**標準 Defender ＋ Hyper-V の両層**の
ファイアウォール許可規則＝`rpgdev setup-firewall` が適用。標準は `RemoteAddress 172.16/12`、Hyper-V は WSL vmCreator の既定 Block の例外）。詳細は
[docs/windows-wsl.md](docs/windows-wsl.md)。

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
npm run render:bgm                    # BGM 7トラックを再生成（public/audio の BGM wav）
npm run render:sfx                    # 攻撃/帰還/被弾の効果音(SFX)を再生成
npm run demo                          # 起動中のサーバに対して擬似 Hook シーケンスを流す
npm run trace                         # 演出トレースを解析（二連続/欠落/取りこぼしの検出。docs §10）
```

`npm run demo` は事前にサーバが起動している必要がある（`rpgdev` / `npm run server`）。
`npm run trace` は `.rpgdev/events.ndjson`（reducer の emit）と `playback.ndjson`（overlay の再生）を
由来 Hook の `seq` で突き合わせる（`--all` / `--seq N` / `--anomalies`）。

## リリース（npm publish）

詳細は [docs/releasing.md](docs/releasing.md)。要点だけ：

- **rpgdev は npm 公開済み**（2026-06-05 に v0.1.0 初公開）。**2回目以降の更新は classic Automation トークン＋パッケージ側 `mfa=automation`（Publishing access = Require 2FA or automation tokens）で publish できる**＝バージョンを上げて `npm publish --access public` だけ。OTP 不要（**granular トークンや 2FA 無効化では通らない**＝2026-06-07 訂正。`npm whoami` が通れば classic トークンが入っている。詳細は docs/releasing.md）。
- Claude に publish させるには `.claude/settings.local.json` の `permissions.allow` に `Bash(npm publish:*)` が必要（gitignore 対象なので無ければ足す）。`cd && npm publish` の複合だと許可パターンに当たらないので、`npm publish <repo path> --access public` の形で叩く。
- **罠（もう再発しないが知っておく）**：npm の granular トークンは「まだ存在しないパッケージ」を作れない。**新規パッケージの初回 publish だけは対話 `npm login` + OTP が必須**（granular だと PUT 404、whoami 401）。既存パッケージの更新では起きない。トークンを何度替えても初回作成は通らないので、新規 publish で 404 が出たら token を疑う前に「初回は OTP」を思い出すこと。

## 現行ゲームモデル（重要）

ゲームモデルは「TODO 項目＝モンスター」ではなく「**モンスター＝ランダムエンカウント**」。
モンスターは TODO 項目から湧かない。ツール使用ごと（PreToolUse）に 20% の確率で出現する
エンカウントで、同時に画面へ出るのは最大1体（2体同時出現はしない）。スプライト/HP/反撃種別は
ステージ別 `MONSTER_CATALOGS` からランダムに選ぶ（HP は演出専用。field は Slime/Goblin/Orc/Ogre、
dungeon/castle は各ステージ専用モンスター。castle の Dragon/Demon Lord は TODO が4個以上で最後の TODO が
現在地の時だけ抽選。詳細は docs §2/§3）。`battle`
フェーズになるのは「エンカウントのモンスターが画面に居る時」だけで、TODO があるだけでは
戦闘にならない。

**ペーシング（唯一の頭＝サーバーが時刻で律速。多エージェントの洪水でも点滅させない。詳細は docs §12）**：
出現は確率に加えて**出現クールダウン（討伐後 4s）＋連続出現の最小間隔（2s）**で律速する。討伐条件を満たしても
**最低在席時間（出現から 4s）**未満なら即討伐せず `pendingDefeat` に保留し、寿命経過後の次の Hook でスイープ確定する
（Stop だけは寿命無視で強制討伐）。これで「倒して即湧き→即死」の点滅が起きない。ペーシングの基準時刻は
**サーバーが `reduceHookEvent` に注入**する（`event.at`＝エージェント側の時計は使わない）。`handleHook` は `event.id` で冪等化する。

**dungeon/castle 限定の強制エンカウント（30秒保証）**：後半の細かい TODO で 20% を引けず最後まで敵が出ないことがあるため、
dungeon/castle では突入(`stageEnteredAt`)・直近出現・直近討伐のうち最新から **30秒（`FORCED_ENCOUNTER_MS`）**経っても敵が居なければ、
次の PreToolUse で 20% 判定をバイパスして**確実に出現**させる（`forcedEncounterDue`）。field は対象外。クールダウン(4s)/最小間隔(2s)は
30秒 >> なので強制時も満たされる。`stageEnteredAt` はステージ変化時とターン開始時に更新、拠点リセットで 0。

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
TODO 一覧を元の順序のまま3区画へ均等割りし（端数は castle 側を厚く＝端数で減らすのは field→dungeon の順）、各項目に `stage` を付与する。
現在地は最初の未完了 TODO のステージで、completed が進むほど奥（dungeon→castle）へ進む。
背景画像（field/dungeon/castle.png）と BGM トラックがステージで切り替わる。TODO 不在は常に field。
ステージは背景/BGMと出現カタログ（敵の名簿）に影響するが、討伐条件やエンカウント確率には影響しない。詳細は docs §2.1。

**1つの Hook では1アクションだけ**（出現／召喚／攻撃／前進のいずれか1つ）。出現→攻撃→召喚を
同一 Hook で連鎖させない。攻撃・増援召喚は敵が居なければ起きない。

精霊（仲間 allies）：戦闘中はツール使用ごと（PreToolUse）に 20% で1体だけ増援し（`BATTLE_SUMMON_CHANCE=0.2`）、
`SubagentStart` でも1体参戦する。常に1体ずつで属性の重複を避け（火 Ignis / 地 Terra /
風 Sylph / 水 Aqua）、上限4体。**精霊の追撃は reducer では出さない（脱Hook。多エージェントで多重化するため）。
フロント（overlay.js `enqueueSpiritFollowup`）が「勇者スキル攻撃を再生した時点」で在席精霊ぶんの追撃を
キューへ生成する**＝Hook 数で増えず「再生された勇者スキル1回につき1巡」だけ（属性別エフェクト＋効果音、討伐の5撃には数えない）。詳細は docs §12。
モンスターを倒すたびに精霊は全員退場するが、**撃破演出（モンスター消滅）を見せ切ってから1体ずつ順番に
FIFO で帰還**する（各帰還に属性色のエフェクト＋`ally-return` 効果音。reducer は `ally_return` に `element`/`name`/
`last` を付け、フロントは最後の `last` 帰還が終わってから背景/BGMを切り替える＝精霊が全員帰る前に背景を変えない）。
`SubagentStop` でも1体ずつ FIFO（最初に出た精霊から）帰還する。
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
- 戦闘表示の精霊4体は `public/overlay.css`（`body[data-phase="battle"]` の `.ally-fire`/`.ally-earth`/`.ally-wind`/`.ally-water`）で各自固有の表示サイズを持つ（最大幅：火 469px / 地 372px / 風 435px / 水 418px）。`.ally-water`（Aqua）は共通基準に対する一律1割拡大ではなく固有値で、実際は火・風より小さい。
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
④戦闘→探検／町→探検（idle・complete→field。v0.5.7 追加）の遷移は `#sceneTransition` の全画面トランジション（`title.png`＋自己ホスト Cinzel のテキストが右上→中央→左下）で
覆い、被覆ピークで背景/勇者を差替＝瞬間移動を隠す。⑤クエストはオーナーセッション限定で、**町／冒険の二相モデル**で律する
（`ownerSession`/`isOwnerSession`。唯一の相判定は `state.active`。`active=true` にできるのはクエスト発行だけ。詳細は docs §15）。
**町（`!active`＝冒険前/ターン終了後）はクエスト発行（UserPromptSubmit のテキスト or TodoWrite/update_plan）だけを受け付け、
それ以外（攻撃・出現・Stop・精霊・反撃）は全部ドロップ**＝最初に発行したセッションがオーナーになり冒険開始。
**冒険中（`active`）は全セッションのフックを受け付ける（出現・スキル攻撃・精霊＝全員ぶん反映＝攻撃が沢山起きる）が、
クエスト更新（TODO）とターン終了はオーナーのみ**＝非オーナーの TODO はクエストを変えずツール使用として戦闘だけ駆動、非オーナーの Stop は前進のみ。
ロックは**冒険まるごと**（毎フックのアイドル奪取は廃止）＝オーナーが街に戻る（オーナーの Stop＝`finishTurn`。応答ごとに発火し毎ターン自然に町へ戻り交代）まで奪取不可。
オーナーが応答途中でクラッシュして無反応のまま固まった場合は、**時間切れ自動解除**（`OWNER_IDLE_RELEASE_MS`＝5分 無反応で次の非オーナー発行が引き継ぐ。`ownerActivityAt` で計測）＋
**手動「街に戻る」ボタン**（overlay の `#townButton`→`POST /control/return-town`＝合成 SessionStart で `townReset`）で復旧する。⑥`SubagentStart`/`SubagentStop`
フックを配線（reducer は元から対応・`examples/` の設定にも追加）。

設計判断・Codex/Claude のフック実機検証結果・実装ステータスは
[docs/design-todo-rpg.md](docs/design-todo-rpg.md) が単一の正典。reducer に手を入れる前に必ず読む。
reducer ([server/adventure-state.mjs](server/adventure-state.mjs)) と
そのテスト ([test/adventure-state.test.mjs](test/adventure-state.test.mjs)) は実装済み。
フロントエンド（[public/overlay.js](public/overlay.js) / [public/app.js](public/app.js)）も
state / effect に配線済み。overlay には精霊スプライト、斬撃、技名カットイン、揺れ、
召喚/属性別追撃演出、ステージ別背景、出現（ポータル+煙）/撃破（発光+破片）アニメと効果音
（`monster-appear.wav` / `monster-defeat.wav`）があり、攻撃/リアクションのアニメは全体共通の
単一キューで直列化される（勇者攻撃・精霊追撃・精霊召喚はすべて前のキュー再生開始から固定1秒間隔
＝前のキューが無ければ即座、その他はアニメ目安+0.1秒で次へ。モンスター出現の
演出開始から4秒間（`APPEAR_ATTACK_DELAY_MS=4000`）は攻撃/召喚キューを再生しない＝出現演出と直後の初撃/召喚を被らせない
（＝登場の4秒後に最初のキュー再生）。精霊召喚も攻撃キューと同じ扱いで、カード表示も召喚がキューで再生される瞬間まで
伏せる（`awaitingSummon`＝state更新で先にカードを出さない）。出現/帰還/
クリア等の即時演出はキューを占有しない。撃破時はキュー内の攻撃を捨てず、トドメに至った攻撃を順に
流してから会心の一撃（`finisher`＝斬撃。技名テキストは出さず視覚演出のみ）→撃破＋消滅を流す
（旧実装は撃破時に攻撃を破棄しており通常攻撃が欠落して見えた）。撃破中はワールド演出を約1.8秒保留して撃破を見せる）。
重なり順は `.monster`(z-index:3) < 水精霊 Aqua `.ally-water`(4) < 勇者 `.hero`(5) < 火/地(6) < 風(8)＝勇者は敵と水精霊の前面・火/地/風は勇者の前面（v0.5.8。`.allies` の stacking context を外し各精霊を `.stage` 文脈で個別評価）。仲間精霊は `Ignis` / `Terra` / `Sylph` / `Aqua` の4体。
docs §8 の宿題（Codex 非Bash失敗フィールド、Claude TodoWrite payload、TODO無しセッション方針）は全て検証・決定済み。

## アーキテクチャ

システム全体は **一方向のパイプライン**: Hook イベント → reducer → 永続化された
状態 → SSE ブロードキャスト → UI。

1. **Hook CLI** ([scripts/rpg-hook.mjs](scripts/rpg-hook.mjs)、`rpgdev-hook <provider> <event>` として公開)
   は Hook ペイロードを JSON として stdin から読み、サーバの起動を確認し、
   `{id, provider, event, raw, at}` を `/hook` に POST する（`id`＝Hook 個体識別子＝トレースの由来キー。docs §10）。`UserPromptSubmit` の時は
   デスクトップウィンドウも起動する。

2. **サーバ** ([server/rpgdev-server.mjs](server/rpgdev-server.mjs)) は依存ゼロの
   `node:http` サーバ。`/hook` で reducer を実行し、永続化してブロードキャストする。
   静的フロントエンドの配信に加え、`/hook`、`/state`、`/events`（SSE）、`/health`、`/trace`、
   `/control/reset`、`/control/return-town`、`/control/shutdown`（ハブ停止＝トレイの「終了」）、`/control/demo`、
   `/control/counter-hit`、`/control/layout-spirits`、`/control/layout-monster` を公開する。

3. **Reducer / 状態機械** ([server/adventure-state.mjs](server/adventure-state.mjs))
   がアプリの心臓部であり、**唯一のユニットテスト対象モジュール**。純粋関数:
   `reduceHookEvent(prevState, hookEvent, now) → { state, effects, normalized }`（`now` は
   サーバー注入のペーシング基準時刻＝`handleHook` が渡す。docs §12）。I/O なし。
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
   - 討伐は出現時に決まる `linkedTodo` で分岐：`linkedTodo=false` ならスキル攻撃5回または
     ターン終了(Stop)、`linkedTodo=true` なら攻撃では倒れず TODO 項目が `completed` に
     なった時のみ討伐（in_progress TODO が消えると linkedTodo は解除）。
   - 攻撃/増援判定：**PreToolUse は攻撃しない（勇者の通常攻撃は廃止）**。PreToolUse は 20% エンカウント出現判定、
     戦闘中は 20% 精霊増援判定（`BATTLE_SUMMON_CHANCE=0.2`）、出なければ前進（1ツール呼び出し1アクション）。PostToolUse はスキル攻撃（技名＝tool_name 基準＝
     PascalCase / MCP はサーバ名。コマンド/パッチ本文は見ない＝apply_patch の「***」を回避）のみで
     出現・増援判定はしない。**攻撃も討伐ヒットも PostToolUse スキル攻撃だけ**。精霊の追撃はフロントが
     スキル攻撃の再生時に生成する（reducer では出さない＝docs §12）。
     `SubagentStart` でも精霊1体参戦、`SubagentStop` で FIFO 帰還（最初に出た精霊から）。
   ここの挙動を変えたら [test/adventure-state.test.mjs](test/adventure-state.test.mjs) を更新すること。

4. **デスクトップウィンドウ** ([scripts/desktop.mjs](scripts/desktop.mjs))。`desktop.mjs` は
   [scripts/desktop-platform.mjs](scripts/desktop-platform.mjs) の `detectPlatform()` で
   darwin / win32 / wsl / linux に分岐する。**唯一のプラットフォーム依存部**で、reducer/server/フロント等は
   全 OS 共通。
   - **macOS**（[desktop/RPGDevWindow.swift](desktop/RPGDevWindow.swift)）。Swift を `swiftc` でオンデマンド
     コンパイルし（mtime 判定）、`.rpgdev/RPGDev.app` を生成して `open` する。タイトルバー付き・4:3固定・
     リサイズ可能なフローティング窓（`.titled`＋`.floating`、`LSUIElement`、内部 1024x768 を全体ズーム）に
     載せた背景透過（`drawsBackground=false`）の `WKWebView`。`window.webkit.messageHandlers.rpgdev` の
     JS↔Swift ブリッジで音声をネイティブ再生（7 BGM ループ＋11 SFX を `AVAudioPlayer`）。位置/サイズは
     `UserDefaults` に保存し復元（ディスプレイ構成変更でリセット、`isRestorable=false`）。
   - **Windows / WSL2**（[desktop/RPGDevWindow.cs](desktop/RPGDevWindow.cs)）。C# WinForms+WebView2 を
     在来 `csc.exe`（.NET Framework 4.x）でオンデマンドコンパイル（swiftc 方式と同型・npm 依存ゼロ）。
     **ネイティブ音声ブリッジは無い**＝overlay の `<audio>`/WebAudio が鳴らす（BGM は同じ WAV、SFX は合成版）。
     リサイズ品質は Window-to-Visual hosting（ちらつき防止）＋ ZoomFactor 再ラスタライズ＋整数倍 letterbox
     （ドット絵維持。`BoundsMode=UseRawPixels`/`RasterizationScale=1`）。最前面/タスクバー非表示/4:3/位置永続化
     （`%LOCALAPPDATA%\rpgdev\hub\desktop-window-win.json`）/単一インスタンス（C# named Mutex＝固定キー `rpgdev-hub`。**`Global\` 名前空間＋Everyone 許可 ACL でセッション横断 dedup**＝Windows ネイティブ起動と WSL2 interop 起動が別セッションでも窓は1つ。`Local\` だと別セッションで二重窓になる既知不具合の修正。`Global\` 不可環境は `Local\` にフォールバック）。
     **Windows/WSL2 はサーバ（ハブ）を Windows ホスト上に1つだけ・Windows ローカルのファイルから起動し `0.0.0.0` で待ち受ける**
     ＝状態も窓ビルドも `%LOCALAPPDATA%\rpgdev\hub`（win32 もプロジェクト別 `.rpgdev` でなくここ。エラーログのみプロジェクト
     `.rpgdev`）。win32 はローカル node でハブを spawn、wsl は interop で Windows の `node.exe` が `server/`＋`public/` を hub dir に
     コピーしてから起動する（**WSL 共有 `\\wsl.localhost` から直接実行すると WebView2 が配信(SSE)を受けられない**＝今回の修正）。
     住所は `scripts/hub-net.mjs` の用途別3関数＝`hubBindHost`（待受。win32/wsl は 0.0.0.0）/`hubReachHost`（このプロセス→ハブ。
     win32 は 127.0.0.1、wsl は既定ゲートウェイ＝ホストの WSL アダプタ IP）/`HUB_WINDOW_HOST`（窓の接続先＝常に 127.0.0.1）。
     env は `WSLENV` で越境。**窓は両者とも `localhost:37373` へ繋ぐ**（窓は必ずハブと同ホスト）。物理 NIC は Defender 既定遮断で
     露出せず、WSL→ホスト inbound を許可する標準 Defender ＋ Hyper-V の両層の許可規則が要る（`rpgdev setup-firewall` が両層を適用）。セットアップ順非依存。
     WebView2 SDK DLL は `desktop/webview2/` に同梱（無ければ明確エラー）。同梱 DLL のコピー（`copyDll`）は、
     実行中の窓が掴んでいて上書きできない（`EACCES`/`EBUSY`/`EPERM`）かつ既に配置済みなら**落ちずに続行**＝窓が動いたままの再起動でクラッシュさせない。詳細は
     [docs/windows-wsl.md](docs/windows-wsl.md)。
   - **Windows/WSL2 のタスクトレイ常駐**（[desktop/RPGDevTray.cs](desktop/RPGDevTray.cs)）：ハブが起動しているか分かりづらい問題への可視化。
     窓 exe(RPGDev.exe) とは別の C# WinForms NotifyIcon（WebView2 不要）を `desktop.mjs` が窓と一緒にビルド・起動する。
     アイコンは水の精霊 Aqua の顔をスプライト `ally-water-facing-slit.png` から実行時に機械的に切り出す（System.Drawing＝外部画像ツール不要・`--make-ico` で .ico も生成）。
     `/health` を3秒ごとに監視し連続失敗でトレイ自身も退場＝**トレイの有無＝ハブの稼働**。右クリックで窓を開く/街に戻る(`/control/return-town`)/終了(`/control/shutdown`＝ハブ停止)。
     単一インスタンスは窓と同じハブ dir の `rpgdev-hub.tray.lock`（ファイルロック）。**スタートメニュー登録は `rpgdev setup-shortcut`**（管理者不要・`%APPDATA%\…\Start Menu\Programs\RPGDev.lnk`＝顔 .ico 付き・Target は `rpgdev` 起動。WSL2 からも interop で作成）。
   - **素の Linux**：窓なし。`npm run web`（ブラウザ表示）へ明確に誘導。

5. **2 つのフロントエンド、1 つのサーバ:**
   - `/` → [public/index.html](public/index.html) + [public/app.js](public/app.js) — フル Web ビュー。
   - `/overlay.html` → [public/overlay.js](public/overlay.js) — デスクトップ窓の WebView
     （macOS=WKWebView / Windows・WSL2=WebView2）内で読み込むコンパクトなウィンドウ UI。
     ネイティブブリッジが無い時（Windows/WSL2 や素のブラウザ）はページ内 WebAudio に
     フォールバックする。
   どちらも `/events` を `EventSource` で購読し、`effects` 配列に反応するだけで、
   ゲームロジック自体は計算しない —— サーバが唯一の信頼できる情報源。

## 状態・永続化・設定

- 実行時の状態はすべて **プロジェクト単位** で `<PROJECT_DIR>/.rpgdev/` 配下に書かれる:
  `state.json`（現在の状態、起動時に読み込む）、`events.ndjson`（reducer の emit ログ。各 effect は
  由来 Hook の `origin` 付き）、`playback.ndjson`（overlay が実際に再生/取りこぼした演出のトレース。
  `POST /trace` 由来。演出の乱れ解析用＝docs §10）、`*-errors.log`。`.rpgdev/` は gitignore 済み。
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
- **静的配信は Range 対応を保つ**（`server/rpgdev-server.mjs` の `serveStatic`＋純関数 `server/http-range.mjs`、`test/http-range.test.mjs` がガード）。
  `/audio/*.wav` を `Content-Length` 無し・チャンク転送で丸ごと流すと、WebView2/Chromium の `<audio>` が
  「シーク不能ストリーム」と見なし、7本の BGM 要素が同時接続を抱え込んで後発の `dungeon-*`/`castle-*` が
  読み込まれず無音になる（v0.7.6 で根治）。`Content-Length`＋`Accept-Ranges`＋`206` を返す挙動を壊さない。
- **二重起動防止**：同一プロジェクト・同一ポートでサーバ／ウィンドウが二重に立たないようにする。
  サーバは listen の `EADDRINUSE` を捕捉し、既存ありとして**後発を `exit 0` で退場**させる（クラッシュ・
  エラーログ汚染をしない）。デスクトップは `desktop.mjs` が既存窓を `focusExistingWindow` で検出したら開かず、
  かつ `.rpgdev/desktop.lock`（mkdir のアトミック性＋30秒で stale 奪取）で起動を直列化する。編集時もこの不変条件を壊さない。
- **攻撃/帰還 SFX** は [scripts/render-sfx.mjs](scripts/render-sfx.mjs)（`npm run render:sfx`）で生成し、
  Swift の `sfxNames`（[desktop/RPGDevWindow.swift](desktop/RPGDevWindow.swift)）にも登録する。新しい SFX を足したら両方を更新する。
- BGM（`field` / `adventure` / `battle` / `dungeon-*` / `castle-*` の7トラック）は
  [scripts/render-bgm.mjs](scripts/render-bgm.mjs) で生成される（既存曲を使わないオリジナルの
  クラシック JRPG 調シーケンスを WAV に合成。決定的で乱数なし）。ジェネレータを編集してから
  `npm run render:bgm` を実行すること。BGM の WAV を直接編集しない。
  - 例外：`public/audio/monster-appear.wav` / `monster-defeat.wav` は render-bgm / render-sfx 管轄外の
    効果音アセット（どちらのジェネレータでも生成しない別ファイル）。`npm run render:bgm` / `npm run render:sfx`
    のどちらでも再生成されない。

## Hook の組み込み（ツール利用者向け）

**インストール思想（v0.7.1〜）＝「できるだけスクリプトに任せ、任せられるか（安全に自動でできるか）は AI が判断、人手は権限の壁だけ」**。
利用者は AI に「この GitHub を見てインストールして」と言うだけで、AI が [docs/agent-install.md](docs/agent-install.md) に従い自動スクリプトを順に実行する。
`rpgdev setup`（表示）＝実パス入りの正しい設定（node 絶対パス exec 形式）＋安全マージ手順を**表示**。`rpgdev setup --apply`＝
その設定を**安全に自動書込**（`scripts/apply-hooks.mjs`：`.hooks` だけ・既存維持・`_rpgdev` で冪等・バックアップ＋アトミック・
不正 JSON/想定外形状なら**書かずに理由を返して**AI/人へフォールバック）。`rpgdev setup-firewall`＝WSL2→ホストのファイアウォール許可を
標準＋Hyper-V 両層・再起動耐性（`RemoteAddress 172.16/12`）で適用（昇格は Windows 側でのみ＝WSL からは UAC を出せない）。純関数 `scripts/hook-config.mjs`（`buildHookConfig`／
`EVENT_SETS`）が“正解”の単一の源で、`test/hook-config.test.mjs` がガード。`bin/rpgdev`→`scripts/cli.mjs` が
`setup` だけ分岐（他は `desktop.mjs` で従来同一）。

手動コピー用の設定例も [examples/](examples/) にある: `claude-settings.local.json` →
`.claude/settings.local.json`、`codex-hooks.json` → `.codex/hooks.json`（グローバル導入前提）。呼び出しスタイルの
違いに注意: `rpgdev setup` の Claude 出力は exec 形式（`command`=node 実体, `args`=[script, provider, event]）、Codex は
インライン文字列。手動見本の Claude はシェル形式（`args` 無し単一文字列＝Windows でもシェル経由でシム解決）。
**Windows ネイティブの Claude は exec 形式＋bare `rpgdev-hook` だとシェル非経由で `.cmd` シムが解決されず発火しない**ため、
`rpgdev setup` の node 絶対パス形式を使う（詳細は docs/install-hooks.md / docs/windows-wsl.md）。フックは新セッションで反映。
書き込み先はスコープで変わる：プロジェクトは `.claude/settings.local.json`、ユーザー全体（`--user`）の Claude は
`~/.claude/settings.json`（**ユーザー全体の `settings.local.json` は Claude Code に読まれない**＝v0.6.0 のバグ。v0.6.1 で修正）。
パスは `scripts/hook-config.mjs` の `hookTargetPath` が正典（`test/hook-config.test.mjs` がガード）。
