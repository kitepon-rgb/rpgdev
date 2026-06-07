# RPGDev 再設計メモ：ランダムエンカウント モデル

最終更新: 2026-06-07
ステータス: **実装済み・検証済み**。現行コードは ランダムエンカウント モデルへ移行済み。
このドキュメントは、設計判断・実機調査・実装ステータスの単一の記録。

モデルは「エラー＝モンスター」→「TODO＝モンスター」→「ランダムエンカウント」と変遷した（最新は本ドキュメントの記述）。
v0.3.0 でランダムエンカウント モデルの上に **冒険ステージ（field / dungeon / castle）** を載せた（§2.1）。

各項目に **[決定]** / **[検証済]** / **[仮定・要確認]** / **[実装済み]** などの状態を明記する。憶測を確定と混ぜない。

---

## 0. なぜ作り直すか（モデルの変遷）

**[検証済]** 第1世代の「エラー＝モンスター」モデルは、失敗検知が壊れていた。

旧 `server/adventure-state.mjs` の `detectFailure` は、ツール出力テキストに
`/\b(error|failed|failure|exception|traceback|panic|fatal)\b/i` が含まれたら失敗扱いする。
このリポジトリ自身の `.rpgdev/events.ndjson`（実運用ログ）を解析した結果：

- 実運用(claude)の `PostToolUse` 28回中 **7回（約25%）がモンスター化**。
- その7体の正体は `Read` / `Write` / `echo` / `cat` / `grep` など、**全部ただの成功作業**。
  ファイルやコマンド出力に「error」という単語が入っていただけ。本物の失敗は実質1件のみ。
- 皮肉：このプロジェクト自体が「error」という単語まみれなので、開発するほど偽モンスターが湧く。

結論：単語マッチによる失敗検知は信号として信用できない。`detectFailure` の正規表現は廃止した。

**[検証済]** 第2世代の「TODO 項目＝モンスター」モデルは偽陽性は消えたが、別の地味さを抱えた。
TodoWrite/update_plan を一度も使わないセッションではモンスターが一切湧かず、戦闘ゼロのまま終わる。
実際の Claude/Codex セッションは TODO を使わないものも多く、「平和な探検」と割り切っても画が地味になりがちだった。
また「モンスター＝TODO 項目」だと、TODO が常に戦闘の中心になり、ツール作業そのものが戦闘につながらない。

**[決定]** 第3世代＝現行の「ランダムエンカウント」モデルへ移行した。
モンスターは TODO からは湧かず、**ツール使用ごと（PreToolUse）に確率で出現する「エンカウント」**にした。
これで TODO の有無に関わらず戦闘が起き、ツールを使うほど冒険が動く。
TODO は戦闘の源ではなく「クエストの一覧表示」＋「紐づくエンカウントの討伐トリガー」に役割を変えた（§3）。

---

## 1. コアコンセプト [決定]

**モンスター＝ランダムエンカウント。** エラーでも TODO 項目でもない。

- モンスターはツール使用ごと（PreToolUse）に **20% の確率で出現する「エンカウント」**。同時に出るのは最大1体（2体同時は無い）。
- スプライト/HP は `MONSTER_CATALOG`（Slime/Goblin/Orc/Ogre）からランダムに選ぶ。HP は演出専用で殺傷力なし。
- 各エンカウントは出現時に `linkedTodo` フラグを持つ：出現時に in_progress の TODO があれば `linkedTodo=true`、無ければ `false`。
  このフラグで討伐条件が変わる（§3）。
- **TODO（クエスト）はモンスターを湧かさない。** TODO は画面上のクエスト一覧表示と、紐づくエンカウントの討伐トリガーを担う（§3）。
- **TODO 未発生時は、ユーザー入力(UserPromptSubmit)を1つのクエスト(`synthetic:true`, in_progress)として表示**し、TodoWrite/update_plan が来たら本物の TODO に置き換える。synthetic は表示専用で、エンカウントの `linkedTodo` には数えない（＝合成クエスト中に出た敵も 5撃/ターン終了で討伐できる）。

---

## 2. フェーズ設計 [決定]

4フェーズ：`idle`（街・待機）/ `field`（探索）/ `battle`（戦闘）/ `complete`（クリア）。
BGM トラック（`currentTrack`）は冒険ステージ（§2.1）と phase の積で決まる7種：
`field`（拠点・序盤探索）/ `adventure`（序盤探索の進行）/ `battle`（序盤戦闘）/
`dungeon-adventure` / `dungeon-battle` / `castle-adventure` / `castle-battle`。
`trackForState` が `adventureStage` と phase から1トラックを選ぶ。

フェーズはもう TODO ステータスには対応しない。**エンカウントのモンスターが画面に居る時だけ `battle`** になる：

| phase | 意味 | 演出 |
|---|---|---|
| `idle` | 街・待機 | 街で休む。SessionStart で quest/monsters/allies をクリア |
| `field` | 探索 | フィールドを進む。エンカウント未発生・敵不在 |
| `battle` | 戦闘 | エンカウントのモンスターが画面に居る。常に最大1体 |
| `complete` | クリア | 一区切り |

**重要**：**TODO があるだけでは `battle` にならない。** モンスター（エンカウント）が出現して初めて戦闘になる。
逆に TODO を一度も使わないセッションでも、ツールを使えば 20% でエンカウントが起きるので戦闘が発生しうる。
（第2世代の「TODO無し＝戦闘ゼロ」問題はランダムエンカウントで解消した。§0 の変遷を参照。）

- エンカウントは PreToolUse ごとに 20% で1体だけ出現する。出現中は `battle`、討伐すると `field`（敵が居なければ）へ戻る。
- 探検（field）と戦闘（battle）の対比はエンカウントの有無で自然に生まれる。

---

## 2.1 冒険ステージ（biome：field → dungeon → castle）[実装済み]

phase（idle/field/battle/complete）とは独立に、**冒険の「場所」を表す `adventureStage`** を持つ。
`field`（草原・序盤）/ `dungeon`（洞窟・中盤）/ `castle`（城・終盤）の3段で、背景画像と BGM が切り替わる。
クエスト（TODO）の進捗に応じて自然に奥へ進む演出で、TODO が無いセッションでは常に `field`。

- **TODO をステージに割り当てる**（`assignQuestStages` / `questStageCounts`）：
  TODO 一覧を元の順序のまま field→dungeon→castle の3区画へ均等割りする。割り切れない端数は**前のステージ（field 側）を厚く**配る
  （例：1件=[field]、2件=[field,dungeon]、3件=[field,dungeon,castle]、4件=[field,field,dungeon,castle]、5件=[field,field,dungeon,dungeon,castle]）。
  各クエスト項目は `stage` フィールドを持つ（`{ label, status, stage }`）。
- **現在地＝最初の未完了 TODO のステージ**（`currentAdventureStage`）：completed を消化していくほど奥（dungeon→castle）へ進む。
  全完了なら最後の項目のステージ。TODO 不在（合成クエスト含む）や未知の値は `field` にフォールバック。
- **BGM/背景はステージ×phase で決まる**：`trackForState` がステージ別の探索/戦闘トラックを返し（§2）、
  フロントは `adventureStage` から背景（`field.png` / `dungeon.png` / `castle.png`）を選ぶ。dungeon/castle では skyline を隠す。
- ステージはあくまで TODO 進捗ベースの**演出**で、討伐条件（§3）やエンカウント確率には影響しない。
- `SessionStart`（拠点リセット）で `adventureStage` は `field` に戻る。

---

## 3. 戦闘モデル [決定]

### モンスター＝ランダムエンカウント
- モンスターは TODO からは湧かない。**PreToolUse ごとに 20% の確率で1体だけ出現**する（2体同時は無い）。
- スプライト/HP は `MONSTER_CATALOG`（Slime/Goblin/Orc/Ogre）からランダム。HP は演出専用で殺傷力なし。
- 出現時に `linkedTodo` フラグを決める：出現時に in_progress の TODO があれば `linkedTodo=true`、無ければ `false`。

### 討伐条件＝linkedTodo で分岐 [決定]
- **`linkedTodo=false`（TODO 不在で出現）**：hero の攻撃 **5回** で討伐、または **ターン終了（Stop）** で討伐。
- **`linkedTodo=true`（in_progress TODO 中に出現）**：攻撃では倒れない。
  **TODO 項目が1つ `completed` になった時**、または **ターン終了（Stop）** で討伐する。
  in_progress TODO が無くなったら `linkedTodo` は解除され、その後は通常の 5撃／ターン終了で倒せる。
  これはターン終盤に TODO status の整理漏れが残っても、戦闘を次ターンへ持ち越さないための最終クリーンアップ。
- HP は演出専用で、HP では討伐しない（上の条件のみで討伐）。

### 攻撃＝ツールフック（1 Hook = 1 アクション）[決定]
- **1つの Hook では「出現 / 召喚 / 攻撃 / 前進」のいずれか1つだけ**を実行する（出現→攻撃→召喚を同一 Hook で連鎖させない＝演出上の違和感を排除）。
- **PreToolUse**：敵不在なら 20% で出現（出たらそれだけ／出なければ前進）。敵在席なら 10% で精霊増援（召喚したらそれだけ）／召喚しなくても**勇者は攻撃しない（通常攻撃は廃止。§12）**。攻撃は PostToolUse のスキル攻撃だけ。
- **PostToolUse → スキル攻撃。技名＝tool_name 基準**（`SKILL_DAMAGE`, 演出）。`skillName()` が tool_name を整形する：通常ツールは PascalCase（アンダースコア除去＋各語頭大文字。`apply_patch`→ApplyPatch, `spawn_agent`→SpawnAgent, `Bash`→Bash）、MCP はサーバ名（動作の1つ手前の区画を PascalCase・末尾 "mcp" 除去。`mcp__aiterm__pty_read`→Aiterm, `mcp__codex_apps__x_hermes_mcp__generate_image`→XHermes）。**コマンド/パッチ本文は一切見ない**（Codex の `apply_patch` は command が "*** Begin Patch…" だが技名は「ApplyPatch」になり「***」にならない）。出現・増援の判定はしない（Pre のみ）。
- 攻撃も増援召喚も、敵（エンカウント）が居なければ起きない（敵不在 Hook は前進のみ）。トドメになった攻撃は、その帰結として撃破＋精霊退場を伴う（同一アクションの結果であり別アクションではない）。
- 技名＝ツール名はプロバイダで品揃えが違う（後述）。未知ツールは生のツール名をそのまま技名に出す
  （握りつぶして通常攻撃に丸めない）。表示名マップは任意。

### 失敗→反撃（counter）[決定]
- 失敗→敵の反撃。失敗信号は **Claude の `PostToolUseFailure` / `PermissionDenied` / 構造化された exit code 非0** のみ。
- `detectFailure` はイベント名と構造化フラグだけを見る（出力テキストの単語マッチは廃止＝§0/§5）。
- **Codex は失敗を payload に出さない**ので検知不能＝反撃しない（§5/§7）。

### 精霊（仲間 allies）[実装済み]
- 戦闘中、**ツール使用ごと（PreToolUse）に 10% で1体だけ増援**（`BATTLE_SUMMON_CHANCE`）。さらに **SubagentStart でも1体参戦**。
- 常に1体ずつ追加し、**属性の重複は避ける**（火 `Ignis` / 地 `Terra` / 風 `Sylph` / 水 `Aqua`）。**上限4体**。
  `Aqua` は水精霊スプライト `ally-water-facing-slit.png` を使う。
- 在席中の精霊は勇者スキル攻撃に続けて現在の敵に**追撃する**（演出。`kind:"ally"`, `allyElement` 付き。討伐の5撃にはカウントしない）。
  **【§12で更新】この追撃は reducer ではなくフロントが「勇者スキル攻撃を再生した時点」で在席精霊ぶんだけ生成する**
  （脱Hook＝多エージェントで多重化しないため）。フロントは `allyElement` で属性別の追撃エフェクト（火/地/風/水）を出す。
- **モンスターを倒すたびに精霊は全員退場**する（戦闘終了で退場）。ただし演出は **撃破（モンスター消滅）を
  見せ切ってから、精霊を1体ずつ順番（FIFO）に帰還**させる。reducer は `ally_return` に `element`/`name`/`last`
  を付与し、フロントは各帰還を属性色のエフェクト＋`ally-return` 効果音で再生、**最後（`last`）の精霊が帰り切って
  から背景/BGM/phase を切り替える**（精霊が全員帰る前に背景を変えない＝`holdWorldVisuals` の解除を last 帰還に委譲）。
- `SubagentStop` で1体帰還（**FIFO＝最初に参戦した精霊から離脱**。hook payload が個体 id を持つとは限らないため、出た順に帰す）。
  在席ゼロでの Stop は無反応（黙って成功扱いにしない＝effect を出さない）。

---

## 4. 使うフック：共通縛り [決定]

**Claude と Codex の両方に存在するフックだけで作る。** 共通集合＝Codex の全10種（すべて Claude にも存在）。

`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PermissionRequest` / `PostToolUse` /
`PreCompact` / `PostCompact` / `SubagentStart` / `SubagentStop` / `Stop`

| hook | フェーズ | 割り当て |
|---|---|---|
| SessionStart | 待機 | 拠点起動・状態ロード・BGM=town（quest/monsters/allies をクリア） |
| UserPromptSubmit | 待機→探検 | クエスト受注、フィールドへ、BGM=field、ターン開始 |
| PreToolUse | 探検/戦闘 | 20% エンカウント出現判定＋戦闘中なら 10% 精霊増援判定＋前進（**攻撃はしない**。§12） |
| PermissionRequest | 保留 | 足止め「!」、判断待ちの硬直 |
| PostToolUse | ★中核 | スキル攻撃＋クエスト一覧更新＋成否分岐（下記） |
| PreCompact | 演出 | 「記憶が霞む／霧」長期戦の区切り |
| PostCompact | 演出 | 「霧が晴れる」状態を再同期 |
| SubagentStart | 戦闘 | 精霊が1体参戦（`state.allies` に追加）。PostToolUse 時に追撃（§3 精霊） |
| SubagentStop | 戦闘 | 精霊が帰還（FIFO で1体離脱＝最初に出た精霊から） |
| Stop | →待機 | ターン終了。在席エンカウントを linkedTodo の有無に関係なく討伐し、街へ |

**PostToolUse の中の分岐：**
- `tool_name` が TODOツール（後述）→ **クエスト一覧（`state.quest`）を更新**（label+status のスナップショット）。
  新たに `completed` になった項目があれば、紐づく（`linkedTodo`）エンカウントを討伐する。モンスターは湧かさない。
- 失敗 → 反撃（Claude のみ検知可）。成功 → スキル攻撃の演出。

**共通縛りで捨てるもの（Claude専用、使わない）：** `Notification` `MessageDisplay` `FileChanged`
`PermissionDenied` `StopFailure` `SessionEnd` `TaskCreated/Completed` `PostToolBatch` `Setup`
`UserPromptExpansion` 他。Claude 限定の追加演出として後乗せは可。

---

## 5. 失敗検知：A案（共通セマンティクス＋プロバイダ別の入力配線）[決定]

「共通だけ」は原則として保つが、**失敗の信号源だけはプロバイダ仕様が物理的に違う**ので分ける。
ゲームの見た目（成功＝ダメージ／失敗＝反撃）は完全に統一する。

| | 成功スキル | 失敗→反撃 | 失敗の見分け方 |
|---|---|---|---|
| **Claude** | `PostToolUse` | `PostToolUseFailure` | **イベント名で判別**（失敗は別イベントで来る）[検証済] |
| **Codex** | `PostToolUse` | **検知不能（後述）** | **payload に成否情報が無い**（§7.2 宿題2 検証で判明）[検証済] |

理由 [検証済]：
- Claude は失敗を `PostToolUse` に送らない。`.rpgdev/events.ndjson` で、exit 1 で失敗した
  `cat … && cat CLAUDE.md` は **`PostToolUseFailure`** として飛んでいた。`PostToolUse` に exit_code を持つ行はゼロ。
- **Codex は失敗を hook payload で一切伝えない**（§7.2 で実機確認）。`PostToolUse` は走るが、
  `tool_response` は stdout 文字列だけで exit code も status も無い。`sh -c 'echo BYE; exit 7'` でも
  `tool_response` は `"BYE\n"`。成功(exit0)と失敗(exit7)の payload が構造的に同一。
  さらに失敗 `apply_patch` は **PostToolUse 自体を発火させない**（PreToolUse のみ）。

> **⚠ 前回の A案（Codex＝PostToolUse の exit code で判別）は実機では成立しない。**
> Codex の hook payload はツールの成否を露出しない。よって **Codex では「失敗→反撃」を hook から駆動できない**（impossible）。

実装上の鉄則：
- **Claude では出力テキストを読むな。イベント名を信じろ**（PostToolUse=成功 / PostToolUseFailure=失敗）。
- **Codex では失敗を検知できない** → 失敗→反撃は **Claude のみ**。Codex のツール失敗は成功（スキル攻撃）として扱う
  （データが無い以上これが正直な挙動。握りつぶしではなく「検知不能」を明示）。
- reducer の exit-code 判定は残すが、これは exit code を構造化フィールドで持つ payload
  （manual/合成、将来仕様）にのみ効く。実機 Codex には効かない。
- 旧 `detectFailure` の単語マッチ正規表現は**完全廃止**。これが偽モンスターの製造機だった。

採用 [決定]：Codex の失敗→反撃は **Claude のみ反撃／Codex は失敗不可視** で割り切る。
`tool_response` の stderr テキストをヒューリスティック判定する案は、廃止した単語マッチの再来なので採用しない。
`transcript_path`（rollout jsonl）を読む案は重く脆いため、将来検討に留める。

---

## 6. プロバイダ別 TODO ツール（名簿の源）

| | Claude | Codex |
|---|---|---|
| ツール名(`tool_name`) | `TodoWrite` **[検証済]** | `update_plan` **[検証済]** |
| 配列キー | `todos` **[検証済]** | `plan` **[検証済]** |
| 項目ラベル | `content` **[検証済]** | `step` **[検証済]** |
| ステータス | pending/in_progress/completed **[検証済]** | pending/in_progress/completed **[検証済]** |
| その他フィールド | `activeForm`（進行中ラベル。reducer では未使用） | — |

Claude 側検証 [検証済、2026-06-05]：実セッションの transcript（`~/.claude/projects/.../<session>.jsonl`）に
記録された TodoWrite の tool_use input を確認。`input = { todos: [ { content, status, activeForm } ] }`、
status 値は pending/in_progress/completed。hook の `tool_input` はツール引数そのものなので同形。
公式ツールスキーマ（content/status/activeForm 必須、status enum 3値）とも一致。

名簿検出＝ PostToolUse で `tool_name ∈ {TodoWrite, update_plan}` を拾い、配列の各項目の
ラベル＋status を読む。status を spawn(pending)/engage(in_progress)/kill(completed) に対応。
→ **3状態が両プロバイダで揃っている**ので「in_progress＝現在の敵」「completed＝トドメ」が両対応で成立。

---

## 7. 実機検証ログ（2026-06-05、Codex CLI 0.136.0）[検証済]

環境：`~/.codex/packages/standalone/current/bin/codex`、model gpt-5.5。
方法：scratch の `tmp/codex-probe` に project-local `.codex/hooks.json`（raw stdin を捕獲する
capture.sh）を置き、**対話 codex** を起動 → ディレクトリ信頼＋「Hooks need review→Trust all」承認 →
plan 更新＋`echo` を実行させて payload を捕獲。

捕獲した `update_plan` の PostToolUse 生 payload：

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "update_plan",
  "model": "gpt-5.5",
  "permission_mode": "bypassPermissions",
  "tool_input": { "plan": [
    { "step": "audit routes",     "status": "completed" },
    { "step": "extract handlers", "status": "in_progress" },
    { "step": "add tests",        "status": "pending" }
  ]},
  "tool_response": "Plan updated",
  "session_id": "...", "turn_id": "...", "transcript_path": "...", "cwd": "...", "tool_use_id": "call_..."
}
```

判明事項：
1. **Codex の plan ツール名は `update_plan`。**
2. **`update_plan` は PreToolUse / PostToolUse の両方を発火させる**（plan更新2回で pre/post 各2回捕獲）。
3. **status は3状態（pending/in_progress/completed）を持つ。**
4. 成功時 `tool_response` は文字列 `"Plan updated"`。

**重要な罠（公式ドキュメントの誤り）**：developers.openai.com/codex/hooks は
「PostToolUse は Bash / apply_patch / MCP tool calls で発火」と書いており、plan ツールを除外して読める。
**実機では update_plan も Pre/PostToolUse を発火させる。** ドキュメントだけ信じると Codex の名簿は
作れないと誤判定する。`codex exec --json` の出力も status を `completed:true/false` の2値に潰すため、
**3状態の事実は対話＋フック捕獲でしか見えなかった。**

### 7.2 宿題2 検証：Codex の失敗は hook payload に出ない [検証済、2026-06-05、対話 codex 0.136.0]

方法：§7 と同じ足場で、対話 codex に成功/失敗のツールを1回ずつ打たせて PostToolUse payload を捕獲。

| 試行 | 結果 | PostToolUse | `tool_response`（実値） |
|---|---|---|---|
| `apply_patch`（行一致・成功） | 成功 | 発火する | 文字列 `"Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:\nM target.txt\n"` |
| `apply_patch`（行不一致・失敗） | 失敗 | **発火しない**（PreToolUse のみ） | — |
| `Bash` `echo HELLO_OK`（exit 0） | 成功 | 発火する | 文字列 `"HELLO_OK\n"` |
| `Bash` `sh -c 'echo BYE; exit 7'`（exit 7） | 失敗 | 発火する | 文字列 `"BYE\n"` |
| `Bash` `ls /nonexistent…`（exit≠0） | 失敗 | 発火する | 文字列 `"ls: /nonexistent…: No such file or directory\n"` |

判明事項（決定的）：
1. **Codex の PostToolUse payload に `exit_code` も `status` も無い。** `tool_response` は出力文字列だけ。
2. **Bash は成功も失敗も同じ構造**（exit 7 でも `"BYE\n"`）。exit code はどこにも入らない＝成否を区別できない。
3. **失敗 apply_patch は PostToolUse を発火させない**（成功時のみ発火し、しかも `"Exit code: 0…"` の文字列を含む）。
4. `apply_patch` の tool_input は `{ "command": "*** Begin Patch …" }`（パッチ本文を command に持つ）。

→ **Codex はツールの成否を hook に露出しない。** 「失敗→反撃」は Codex では hook から駆動不能（impossible）。
   公式ドキュメントの「For Bash, it also runs after commands that exit with a non-zero status」は
   「発火はする」と言っているだけで、**exit code が payload に入るとは言っていない**（罠）。

### Codex フック運用の注意 [検証済]
- **フックはトラスト必須。** `codex exec`（バッチ）は未トラストの自前フックを発火させない
  （`--dangerously-bypass-hook-trust` を付けても発火しなかった。trust 済みフックは exec でも動く）。
  対話起動だと初回に「ディレクトリ信頼」＋「Hooks need review→Trust all」が出て、承認後に動く。
  → RPGDev 利用者は Codex 側で対話的にディレクトリ信頼＋フック承認が必要。
- **async フックは未サポート**（`async hooks are not supported yet` 警告）。Codex 用設定は `async:false` 必須。
- feature flag：`[features].codex_hooks` は非推奨、`[features].hooks` が新名。

---

## 8. 宿題（完了済みの調査）

1. **[完了] Claude `TodoWrite` の payload 形を実機確認。** → §6 検証済。
   `tool_input = { todos: [{content, status, activeForm}] }`、status は3状態。reducer の仮定は正しかった。
2. **[完了・結論=impossible] Codex の非Bash／Bash 失敗フィールド。** → §7.2 で実機検証。
   結論：**Codex の hook payload はツールの成否を一切露出しない。** 失敗 Bash も exit code 無し、
   失敗 apply_patch は PostToolUse 自体が出ない。よって Codex の「失敗→反撃」は hook から不可能。
   §5 の「要決定」(a)/(b)/(c) を参照。現実装は (a)（Codex 失敗は不可視＝成功扱い）。
3. **[完了] TODO無しセッションの方針** → §2 で (a) 割り切り（TODO無し＝平和な探検、保険の敵ソースなし）に決定。実装・テスト済み。

→ **§8 の宿題は全て解消。** 残りは画像/演出（Codex 側）と目視確認のみ。

---

## 9. 実装ステータス（2026-06-07 更新・ランダムエンカウント モデル + 冒険ステージ v0.3.0 / 撃破演出の磨き込み v0.3.1 / v0.4.0：演出トレース §10・二重起動防止 §11・唯一の頭+単一キュー+精霊脱Hook §12・PreToolUse 通常攻撃廃止）

- **reducer：実装済み・検証済み。** `server/adventure-state.mjs` をランダムエンカウント モデルへ。
  - 旧 `detectFailure` の単語マッチ正規表現は廃止。Claude の失敗イベント名（PostToolUseFailure/PermissionDenied）と
    構造化 exit code 非0 のみ → `counter`。実機 Codex は失敗不可視なので成功扱い（反撃しない）。
  - **モンスターは TODO からは湧かない。** PreToolUse ごとに 20% でエンカウントが1体だけ出現（最大1体）。
    スプライト/HP は `MONSTER_CATALOG`（Slime/Goblin/Orc/Ogre）からランダム。HP は演出専用。
  - 出現時に `linkedTodo` を決定（出現時 in_progress TODO あり=true / なし=false）。討伐条件はこのフラグで分岐：
    - `linkedTodo=false` → hero の攻撃 **5撃**、または **ターン終了（Stop）** で討伐。
    - `linkedTodo=true` → 攻撃では倒れず、TODO が1つ `completed` になった時、またはターン終了（Stop）で討伐。in_progress TODO が消えたら `linkedTodo` 解除。
  - TODO ツール（`tool_name ∈ {TodoWrite, update_plan}`）は `state.quest`（label+status+stage のスナップショット）を更新するだけ。
    新たに completed になった項目があれば紐づくエンカウントを討伐。**TODO を field/dungeon/castle の3区画へ均等割り**して各項目に `stage` を付与（§2.1）。
  - **冒険ステージ**：`adventureStage`（field/dungeon/castle）＝最初の未完了 TODO のステージ。`trackForState` がステージ×phase で7種の BGM トラックを選ぶ。SessionStart で field に戻す（§2.1）。
  - PreToolUse=攻撃しない（通常攻撃廃止。§12）/ PostToolUse=スキル攻撃（技名＝tool_name を `skillName()` で整形＝PascalCase / MCP はサーバ名。コマンドは見ない）。出現・増援の判定は PreToolUse のみ。
  - **1 Hook = 1 アクション**：1つの Hook では出現/召喚/攻撃/前進のいずれか1つだけ（同一 Hook で連鎖しない）。
  - **TODO 未発生時はユーザー入力を1つの合成クエスト(`synthetic`, in_progress, stage:"field")として表示**し、TodoWrite で本物に置換。synthetic は表示専用で linkedTodo に数えない。
  - 精霊：戦闘中の PreToolUse ごとに **10%** で1体増援＋SubagentStart で1体参戦。属性重複回避（火/地/風/水）・上限4体。
    在席中は **PostToolUse（スキル攻撃）の時だけ**現在の敵に追撃（`attack` kind:"ally"・`allyElement` 付き、討伐の5撃には数えない）。
    モンスター討伐ごとに精霊は全員消滅。SubagentStop で1体帰還（**FIFO＝最初に出た精霊から**）、在席ゼロでの Stop は無反応。
- **テスト：28/28 pass。** `test/adventure-state.test.mjs`（失敗検知の偽陽性修正・ランダムエンカウント出現・5撃討伐・
  ターン終了討伐・linkedTodo の completed/Stop 討伐・provider parity・冒険ステージ割り当て/追従・ステージ別 BGM・技名は tool_name 基準（PascalCase/MCP→サーバ名・"***"回避）・
  精霊 増援/参戦/重複回避/上限4/PostToolUse 限定追撃/討伐で消滅/FIFO 離脱 等）。
- **フロントエンド：新 state/effect に配線済み。**
  - `public/overlay.html` / `overlay.js` / `overlay.css`：エンカウントのモンスターを画面中央の戦闘相手に、
    在席精霊を属性ごとの定位置に表示。新 effect（monster_appeared/attack(kind,skill,ally,allyElement)/counter/
    monster_defeated/turn_completed/turn_blocked/ally_summon/ally_return/compact_pre/compact_post/hold/step 等）を
    パーティクル＋フラッシュ＋カットインで表示。スキル攻撃は斬撃・揺れ・技名カットイン付き。瀕死点滅・画面全体の赤点滅・「よろけ」表示は廃止。
  - **冒険ステージの背景切替**：`adventureStage` で背景を `field.png`/`dungeon.png`/`castle.png` に切替（idle/complete は `town.png`）。dungeon/castle では skyline を隠す（`public/styles.css` / `overlay.css`）。
  - **出現/撃破の専用演出**：モンスター出現＝ポータル＋煙＋着地アニメ（`data-action="appear"`）、撃破＝発光＋破片の消滅アニメ（`data-action="defeat"`）。
    出現中の色変化 filter は演出終了時に通常状態へ明示的に戻し、WKWebView 側でモンスター色味が永続的に残らないようにする。
    撃破effectを受信したらワールド演出（背景/BGM/フェーズ反映）を保留し、キュー内の会心斬撃などを流して**実際に撃破アニメを再生した後**で次の状態へ切替（`holdWorldVisuals`）。これにより castle 戦闘の Stop 討伐などで、消滅前に field/town へ先行遷移しない。
  - **撃破前の会心の一撃（v0.3.1〜）**：`monster_defeated` をそのまま流すと「何もなく唐突に倒れる」ので、撃破の直前にフロント合成の `finisher`（勇者の会心の一撃＝斬撃＋フラッシュ＋強い揺れ＋バースト＋効果音。**技名テキストのカットインは出さない**＝視覚演出と効果音のみ）を必ず1回差し込む。
    キュー直列化により会心斬撃が終わってから（モンスターはそれまで画面に残す）撃破＋消滅へ進む。討伐は攻撃以外（ターン終了 Stop・TODO完了）でも起きるため、reducer の `attack` 有無に関わらずフロント側で常時挿入する。
  - **属性別の追撃エフェクト**：精霊の追撃（`kind:"ally"`）は `allyElement`（fire/earth/wind/water）ごとに専用のパーティクル＋CSS インパクト＋効果音を出し分ける。
  - **効果音（SFX）**：出現＝`monster-appear.wav`、撃破＝`monster-defeat.wav`。攻撃は勇者の通常攻撃
    `hero-normal-attack.wav`、スキル攻撃 `hero-skill-attack.wav`、会心の一撃 `hero-finisher-attack.wav`、
    精霊追撃 `ally-fire-attack.wav` / `ally-earth-attack.wav` / `ally-wind-attack.wav` /
    `ally-water-attack.wav`、**精霊帰還 `ally-return.wav`**（撃破後に1体ずつ帰る音）。ネイティブブリッジ（Swift `AVAudioPlayer`）があればそれで、無ければ WebAudio の合成音にフォールバック。
    攻撃/帰還 SFX は `scripts/render-sfx.mjs`（`npm run render:sfx`）で生成し、Swift の `sfxNames` に登録する。
  - **演出の直列化**：攻撃/リアクションのアニメは全体共通の単一キューで直列化。**攻撃は固定 1 秒間隔**、その他は「アニメ目安 + 0.1秒」で次へ。
    **モンスター出現の演出開始から 4 秒間（`APPEAR_ATTACK_DELAY_MS`）は攻撃キューを再生しない**（出現演出と直後の PostToolUse スキル攻撃が被らないよう保留する）。出現/召喚/帰還/クリア等の即時演出はキューを占有しない。撃破 effect を含むバッチを受信した瞬間に、過去バッチから溜まっていた攻撃/finisher キューを破棄する。そのうえで**同じバッチ内でトドメに至った未再生攻撃だけは破棄しない**（旧実装は破棄していたため、出現直後に先頭の skill だけ再生され後続の normal が撃破で消えて「通常攻撃が欠落」して見えた）。`monster_defeated` がキューに入った後の別バッチ攻撃は受け付けず、消滅演出を開始した時点でも残っている攻撃/finisher キューを再度破棄する。トドメに至った一連の攻撃を順に再生してから会心の一撃（`finisher`）→撃破演出へ進む。撃破フラグ（`monsterDefeatInProgress`）は撃破演出を**再生した時点**で立てる。詰まり防止に攻撃アニメは最大10件で間引く。
  - **クエストトラッカー UI**：MMO ミッション風パネルを画面中央上に表示。未着手 ◇ / 進行中 ◆ / 達成 ✓。
    全項目完了 / `idle`（街）/ `complete`（ターン終了＝街の待機）では非表示。AI が TODO に止めを刺さず complete に
    なることがあり、街に戻ったのに未完了 TODO が残ると違和感が出るため、街の待機（idle/complete）ではクエスト窓ごと畳む。
  - **ヘッダーは1行**：「RPGDev ◆ <フェーズ>」。RPGDev は金グラデのゲームタイトル（フェーズ名と同サイズ、菱形セパレータ）。ヘッダー高 60px。
  - **戦闘配置**：勇者は左下（戦闘時 +10%）、モンスター中央（-20%）、精霊は属性ごとに固定（水=左上, 風=右上, 火=右端・下げ気味, 地=中央下）。モンスター名は1.7倍。
    勇者は常にモンスターより前面に描く（`.hero` z-index=5 > `.monster` z-index=4。同値だと DOM 後勝ちで勇者が敵の裏に回るため。v0.3.1）。
  - 仲間精霊スプライトを追加：火/地/風/水。`Aqua`（水）は `ally-water-facing-slit.png`。
  - `public/app.js`（Web ビュー）：新 state/effect に追従（精霊・冒険ステージの背景切替を含む）。
  - **BGM：7トラックを `scripts/render-bgm.mjs` から生成**（`field` / `adventure` / `battle` / `dungeon-adventure` / `dungeon-battle` / `castle-adventure` / `castle-battle`）。
    ステージごとに BPM・調・編成を変えてある（dungeon=不穏・低速、castle=荘厳・行進調）。生成器は決定的（乱数なし）。
    攻撃 SFX は `npm run render:sfx`（`scripts/render-sfx.mjs`）で生成する。
    `public/audio/monster-appear.wav` / `monster-defeat.wav` は render-bgm / render-sfx 管轄外の効果音（生成器では作らない別アセット）。
  - **デスクトップ（Swift `RPGDevWindow.swift`）**：7 BGM トラックをプリロードし、`monster-appear`/`monster-defeat` と攻撃 SFX を `AVAudioPlayer` でネイティブ再生（JS↔Swift ブリッジの `sfx` メッセージ）。
  - **ウィンドウ位置・サイズの記憶**：終了/移動/リサイズ時に `window.frame` と全スクリーン署名を `UserDefaults`（`local.rpgdev.overlay`）へ保存し、次回起動時に「署名一致かつ画面内」なら復元、そうでなければ既定位置にリセット（ディスプレイ構成変更＝署名不一致でリセット）。macOS の自動ウィンドウ復元とは競合させない（`window.isRestorable = false`、復元は自前管理）。
  - フロント変更を窓に反映するには WKWebView のリロード（窓の開き直し）が必要。
- 実機検証の生データ：`tmp/codex-probe/`（gitignore 対象、`hook-capture.log` / `probe*-events.jsonl`）。
  ※ 検証中に `~/.codex/auth.json` を `tmp/codex-home/` にコピーしたが、機密のため削除済み。

---

## 10. 演出トレース（内部診断ログ）[実装済み・2026-06-07]

**目的**：「通常攻撃が2連続」「同じスキルが2連続」など、設計（1 Hook = 1 アクション）と
合わない演出の乱れを、**どの Hook 由来か**まで遡って解析できるようにする内部ログ。表向きの
機能ではなく診断専用。演出面すべてに由来 Hook を刻むのが鉄則。

### 由来 Hook の識別子（2層）
- **`hookId`**：Hook 個体 ID。Hook CLI（`scripts/rpg-hook.mjs` の `hookId()`）が
  `<provider>.<event>.<時刻36進>-<乱数>` で付け、POST payload の `id` で送る。プロセス境界を跨いでも一意。
  `normalizeHookEvent` は `input.id` を優先採用（demo/manual で未指定なら正規化側で生成）。
- **`seq`**：Hook 通し番号（順序の正準キー）。reducer が `state.hookSeq` を Hook ごとに +1 して付与し、
  `state.json` に永続化＝サーバ再起動でも連番が継続する。「2連続」の判定はこの seq の並びで行う。

### 由来の刻印（reducer：`server/adventure-state.mjs`）
- `reduceHookEvent` の**単一の出口**で `stampOrigin(effects, event)` を呼び、**その Hook が生んだ
  全 effect** に `origin = { seq, hookId, event, provider, tool, at, action }` を付ける。
  個別の `effects.push` を取りこぼさないよう一括で刻む（＝演出面すべてに由来が必ず付く）。
  `action` は同一 Hook 内の effect 連番で、`seq#action` で1つの演出を一意参照できる。
- `state.log` の各行にも `seq` を持たせ、effect の `origin.seq` と突き合わせ可能にした。

### 2つの内部ログ（`<PROJECT_DIR>/.rpgdev/`、gitignore 済み）
1. **`events.ndjson`（emit ログ）**：reducer が出した `{ normalized, effects }` を Hook ごとに1行。
   `normalized` は `id`/`seq` を、各 effect は `origin` を持つ。＝「reducer が何を出したか」。
2. **`playback.ndjson`（再生ログ／新規）**：overlay（デスクトップ窓の本体 UI）が**実際に何を
   再生し、何を取りこぼし、いつ待たせたか**を `/trace` へ POST して残す。各行は
   `{ kind, tag, origin, ... }`。`kind` は `play`（再生）/ `drop`（取りこぼし＋`reason`）/
   `hold`（出現演出と被るので保留＋`wait`）/ `world`（phase/stage/track の遷移＝フィールド前進・
   街帰還・BGM 切替を `from→to` で）。＝「窓が何をしたか」。

   - サーバ：`POST /trace` → `appendPlayback`（`server/rpgdev-server.mjs`）。
   - フロント：`overlay.js` の `trace()`（`fetch keepalive`、失敗は `console.error`、握りつぶさない）。
     計測点＝`effects()`/`pumpFx()`/`clearStaleCombatQueueForDefeat()`（取りこぼしを reason 付きで）、
     `applyWorldVisuals()`（世界遷移を由来 Hook 付きで）。`finisher` はフロント合成（`synthetic:true`）で、
     由来は撃破を起こした Hook を引き継ぐ。
   - **Web ビュー（`app.js`）は計測しない**：診断対象は本体 UI の overlay。Web は補助ビューのため対象外。

### 解析ツール `scripts/rpg-trace.mjs`（`npm run trace`）
- 2ログを `origin.seq` で突き合わせ、Hook ごとの emit/play/drop/hold/world を時系列表示。
- **異常検出**：①実際の再生順（クライアント時刻 t）で**同じ攻撃タグが連続**＝「二連続」を列挙
  （ユーザー報告の症状を直接検出）。②emit したのに play も drop も記録が無い＝**欠落**（窓が閉じていた
  可能性も含め明示）。③取りこぼしを reason 別に集計（`defeat-queued`/`max-queued`/`defeat-in-progress`/
  `defeat-received`/`defeat-play`/`appear-hold`）。
- オプション：`--all`（全件）/ `--seq N`（周辺詳細）/ `--anomalies`（異常まとめと再生順のみ）。

> この章は「演出の乱れを後から解析するための計装」であり、ゲーム挙動（討伐条件・確率・1 Hook 1
> アクション）は変えていない。乱れの**原因の特定と修正**は、このログを採取してから別途行う。

---

## 11. 二重起動防止 [実装済み・2026-06-07]

同一プロジェクト・同一ポートで **サーバ／デスクトップウィンドウが二重に立たない**ようにする。
フック（`rpg-hook.mjs` の `ensureServer`）とデスクトップ起動（`desktop.mjs`）が競合しても1つに収束させる。

- **サーバ（`server/rpgdev-server.mjs`）**：`server.on("error")` で `EADDRINUSE` を捕捉し、
  「既に稼働中」と明示して **後発インスタンスを `exit 0` で退場**させる（クラッシュさせず、`server-errors.log` も汚さない＝
  静かなフォールバック禁止に沿って、成功偽装はせず明示ログ）。その他の listen エラーは `server-errors.log` に記録して `exit 1`。
- **ウィンドウ（`scripts/desktop.mjs`）**：既存窓を `focusExistingWindow`（`pgrep` 検出）で見つけたら **開かずに終了**。
  さらに `.rpgdev/desktop.lock` を `mkdir`（アトミック）で取り、**起動を直列化**する（取得できなければ既存窓の出現を待ってフォーカス／
  30秒以上前の stale ロックは奪う）。これでビルド（`swiftc`）中に複数の起動要求が来ても窓は1つに収束する。
- 検証（2026-06-07）：同ポートに2台目のサーバ起動 → 後発が `already serving` で `exit 0`・`server-errors.log` 生成なし。
  既存窓ありで `desktop.mjs` 実行 → 窓数は1のまま・ロックは解放。

> 背景：開発中に隔離インスタンス（別ポート）を併走させた際、本番ウィンドウと二重に見えたのが発端。
> 別ポート・別バンドルは別物として正しく扱う（防止は同一ポート・同一バンドルの二重を対象）。

---

## 12. 唯一の頭＋単一キュー＋精霊攻撃の脱Hook化（多エージェント耐性）[実装済み・検証済み 2026-06-07]

**動機**：多数のエージェント／並列ワークフローが高速に Hook を撃つと、各 Hook が独立に確率を振って
「倒して即湧き→即死」を繰り返す点滅や、精霊攻撃の多重化が起き、ロジックは正しくても**演出が不健全**に見えた。
原則を「Hook＝配達人 / サーバー＝全エージェント共通の唯一の頭 / 1窓＝1本の絶対キュー / 精霊攻撃＝フロント演出」に統一した。

### サーバー＝唯一の頭（時刻もサーバーが付与してペーシング）
- `reduceHookEvent(prev, event, now)`：**ペーシング基準時刻はサーバーが注入**（`handleHook` が `Date.now()` を渡す。
  テストは `__setNow` で差し替え）。`event.at`（エージェント側の時計）は表示/トレース専用で**ペーシングには使わない**
  （並行エージェントの時計はズレ・逆転しうるため）。`handleHook` は `event.id` で**冪等化**（二重配達で二重出現しない）。
- **出現クールダウン**：`SPAWN_COOLDOWN_MS=4000`（討伐後）＋`MIN_SPAWN_INTERVAL_MS=2000`（連続出現）。
  `state.lastSpawnAt`/`lastDefeatAt`（=0 は「直近イベント無し＝許可」）。`beginTurn`/`townReset` でリセット。差分が負/NaN（時計逆転）なら出現しない（安全側）。
- **最低在席時間**：`MIN_MONSTER_LIFETIME_MS=4000`。5撃や TODO 完了で討伐条件を満たしても、在席が浅ければ
  `finishMonster` が `monster.pendingDefeat=true` に**保留**し、`reduceHookEvent` 冒頭の `sweepPendingDefeats` が
  寿命経過後の「次の任意の Hook」で確定討伐する（取りこぼさない。時計逆転 `now<appearedAt` でも強制確定）。
  `Stop`(`finishTurn`) は `force=true` で寿命無視の強制討伐＝ターンを跨がせない。
- 効果：洪水（30秒で約170 PreToolUse）でも**寿命≥4.0s・クールダウン≥4.0s、即死/即湧き0件**（2026-06-07 トレース実測）。

### 精霊攻撃はフロント演出のみ（脱Hook）
- reducer から `allyAssist`/`ALLY_DAMAGE` を**削除**。PostToolUse は勇者スキル攻撃のみ emit（`kind:"ally"` の attack は出さない）。
- フロント `overlay.js` の `enqueueSpiritFollowup`：**勇者スキル攻撃を再生した時点**で、在席精霊（`latestAllies`）ぶんの
  追撃を `kind:"ally"` 合成 effect としてキュー先頭へ割り込ませる（`ALLY_FOLLOWUP_INTERVAL_MS=360` で連続）。
  撃破中は出さない／`MAX_QUEUED_ATTACKS` を超えない／再生時に精霊が消えていれば出さない（ゴースト防止）。
  ＝**Hook が何回来ても精霊攻撃は「再生された勇者スキル1回につき1巡」**だけで、Hook数では増えない。

### 1窓＝1本の絶対キュー（背景/BGM/シーンも集約）
- 背景/BGM/phase/シーンの遷移を `diffWorldEffect` で **world 効果**に変換し、SSE バッチ末尾へ積む。
  `playEffect` の `world` ケースが `applyWorld` で適用。撃破バッチは `finisher→撃破→精霊帰還→world(背景)` の順に直列化され、
  「精霊が全員帰ってから背景が変わる」が**キュー順で自然に保証**される（旧 `holdWorldVisuals`/`scheduleWorldVisualRelease`
  タイマー hack は撤去）。`render()` は world を適用しない（静的パネル＝クエスト一覧のみ即時反映）。
- 既知の軽微点（パーティクル＋効果音は出るが演出が簡略）：`SubagentStop` 単独の精霊帰還は `render` が先にカードを
  消すためカードのフェード演出は出ない（パーティクル＋音は出る）。撃破保留中に来た `SubagentStart` は保留解除まで反映が遅れる。

### クエスト窓は最下層
- `.roster` を `z-index:1` に（背景画像/暗幕のすぐ前、`.stage`(z:2) が内包するモンスター・勇者・精霊・パーティクル・
  各種エフェクトより後ろ）＝クエスト欄の後ろにあるのは背景だけ。

> 検証（2026-06-07）：reducer テスト 34/34 pass（`__setNow` 注入で決定化＋ペーシング新テスト）。
> 窓を開いた高負荷トレースで点滅0・reducer の `kind:"ally"` attack 0 を確認。多角レビュー（22エージェント）で確定した
> 指摘7件は全て minor、うち5件（時計逆転ガード・dead else 撤去・時刻統一・ゴースト防止・キュー上限遵守）を反映済み。

---

## 13. v0.5.0：精霊ライフ／モンスター反撃／精霊全員ランダム追撃／戦闘→探検トランジション／クエスト親限定／Subagent 配線 [実装済み 2026-06-07]

5つの演出強化（要件1〜5）＋クエスト親限定（要件6）＋Subagent 配線を追加した。

### 13.1 精霊は全員がランダム順で追撃（要件1）[フロント]
- `enqueueSpiritFollowup`（overlay.js）：在席精霊(`life>0`)の**コピー**を Fisher-Yates でシャッフルしてから追撃を積む。
  `latestAllies` 本体は破壊しない。脱Hook（reducer は精霊攻撃を出さない＝§12）は維持。

### 13.2 モンスターの反撃ループ（要件2）[フロント駆動＋サーバー権威]
- 生存モンスターが居て、勇者＋全精霊の攻撃を再生し切り（キュー枯渇）、出現演出も明けたら、`COUNTER_INTERVAL_MS=10000`（10秒おき）で反撃する。
  対象は勇者と在席精霊からランダム。**タイミングは実クロックを持つフロントだけが駆動できる**（reducer はタイマー非保持＝§12）。
- `pumpFx` のキュー枯渇時に `startCounterLoop`、新バッチ受信(`effects` 先頭)・撃破・出現で `stopCounterLoop`。`runCounterTick` も毎回 `counterLoopAllowed` を自己点検。
- 勇者への反撃は state ライフが無いので**フロントで被弾演出のみ**。精霊への反撃は **`POST /control/counter-hit {hitId, allyId}`** でサーバーへ通知し、サーバーがライフ確定（13.3）。二重演出を避けるため精霊被弾はサーバーの `ally_hit/ally_defeated` 受信でのみ再生する。

### 13.3 各精霊にライフ5・被弾退場（要件4）[サーバー権威]
- `summonAlly` で `life: ALLY_MAX_LIFE(=5)` を付与。`CounterHit` イベント→`applyCounterHit` がライフ減算、`>0` で `ally_hit`、`<=0` で当該1体を除去し `ally_defeated(reason:"depleted")` を emit。
- サーバー：`POST /control/counter-hit` が `recentCounterIds`（Hook id とは別リング）で `hitId` を冪等化し、合成 `CounterHit` を `reduceHookEvent` に流して broadcast。
- 撃破時の全員退場（`ally_return` FIFO）は別経路として維持（被弾死とは effect 名を分ける）。旧 state（life 無し）は満タン扱いで互換。

### 13.4 被弾エフェクト＋被ダメージ音（要件3）[フロント＋アセット]
- `playEffect` に `monster_counter`（勇者被弾）/`ally_hit`/`ally_defeated`。`damageSound()`＝ネイティブ `damage-hit.wav`（無ければ WebAudio 合成にフォールバック）。
- `damage-hit.wav` は**対話 Codex が生成**（ミッションのみ指示・ツールは Codex 自由に委譲）。Codex は自律判断で**既存規約どおり `scripts/render-sfx.mjs` に `damage-hit` 合成を追加して `npm run render:sfx` で生成**した（手続き生成の規約を維持）。Swift `sfxNames` に登録済み。
- CSS：`#heroImage[data-action="hit"]` / `.ally[data-action="hit"] img` の被弾アニメ。

### 13.5 戦闘→探検の全画面トランジション（要件5）[フロント＋アセット]
- `diffWorldEffect` が phase `battle→field/complete` を検出して world 効果に `transition`＋`label` を付与。`playEffect` の world(transition) が `#sceneTransition` を再生（`fxAnimMs` で 1500ms キューを占有。通常 world は即時=0 のまま）。
- タイトル一枚絵 `public/assets/title.png`（**対話 Codex 生成**、既存背景とトーン一致、文字焼き込み無し、中央上は穏やか）を全画面背景に、テキストが**右上→中央で一瞬静止→左下**へ流れる（フォント＝自己ホスト Cinzel `public/fonts/cinzel.woff2`・OFL）。
- **被覆ピーク（中央静止）で `applyWorld`（背景/勇者/phase 差替）を実行**＝勇者配置の瞬間移動を隠す。キュー直列の末尾（撃破→精霊帰還の後）で再生される。
- サーバーの MIME に `.woff2/.woff/.ttf/.otf` を追加（無いと 404→無言フォールバックでフォントが効かないため必須）。

### 13.6 クエストは親(オーナー)セッション限定（要件6）[サーバー]
- `state.ownerSession`＝最初に UserPromptSubmit したセッション（`raw.session_id`）。`isOwnerSession` で**非オーナーの UserPromptSubmit/TodoWrite はクエストを更新しない**（spawned した `codex exec` が provider=codex の UserPromptSubmit で親のクエストを乗っ取る事故を防ぐ）。エンカウント/攻撃は §12 どおり全エージェントぶん受ける＝**クエストだけスコープ**。`SessionStart` でリセット。

### 13.7 SubagentStart/SubagentStop の配線 [設定]
- reducer は元々 `SubagentStart→summonAlly` / `SubagentStop→returnAlly`（FIFO）対応済みだが、**フックが未配線**だった（`.claude/settings.local.json` / `.codex/hooks.json` に無い）。両方に追加。
- 実測（2026-06-07・events.ndjson）：ワークフロー実行中、メイン待機の時間帯に親セッションの PreToolUse/PostToolUse が多数記録＝**サブエージェントのツール使用は親フックを発火する**。一方 SubagentStart/Stop は未配線ゆえ 0 件だった（だから戦闘中 10% 増援以外で精霊が出なかった）。これを配線した（Task は公式に親で発火。Workflow も親フックは飛ぶので発火見込み）。

> テスト：reducer **42/42 pass**（要件6・精霊ライフ/CounterHit/退場/旧 state 互換の新規 8 テスト含む）。
