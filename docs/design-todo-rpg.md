# RPGDev 再設計メモ：TODO＝モンスター モデル

最終更新: 2026-06-05
ステータス: **設計＋実機検証フェーズ（未実装）**。現行コードはまだ旧モデル（error＝モンスター）のまま。
このドキュメントは、その日の設計会話と実機調査の単一の記録。実装着手前の唯一の正典。

各項目に **[決定]** / **[検証済]** / **[仮定・要確認]** / **[未着手]** を明記する。憶測を確定と混ぜない。

---

## 0. なぜ作り直すか（旧モデルの破綻）

**[検証済]** 現行の「エラー＝モンスター」は、失敗検知が壊れている。

現行 `server/adventure-state.mjs` の `detectFailure` は、ツール出力テキストに
`/\b(error|failed|failure|exception|traceback|panic|fatal)\b/i` が含まれたら失敗扱いする。
このリポジトリ自身の `.rpgdev/events.ndjson`（実運用ログ）を解析した結果：

- 実運用(claude)の `PostToolUse` 28回中 **7回（約25%）がモンスター化**。
- その7体の正体は `Read` / `Write` / `echo` / `cat` / `grep` など、**全部ただの成功作業**。
  ファイルやコマンド出力に「error」という単語が入っていただけ。本物の失敗は実質1件のみ。
- 皮肉：このプロジェクト自体が「error」という単語まみれなので、開発するほど偽モンスターが湧く。

結論：単語マッチによる失敗検知は信号として信用できない。`detectFailure` の正規表現は廃止する。
代わりに、より確実な実体＝**TODO 項目**をモンスターの源にする。

---

## 1. コアコンセプト [決定]

**モンスター＝TODO 項目。** エラーではない。

- エージェントの TODO リスト（Claude の TodoWrite / Codex の update_plan）の各項目を1体のモンスターに対応させる。
- ステータスでフェーズと戦況を表現する（下記マッピング）。

---

## 2. フェーズ設計 [決定]

3フェーズ（＋idle/complete）：**待機 / 探検 / 戦闘**。

TODO のステータス3状態がそのままフェーズに対応する：

| TODO status | 意味 | 演出 |
|---|---|---|
| （TODOリスト無し／プロンプト前） | 待機 | 街で休む。BGM=town |
| `pending` | 待機列のモンスター | フィールド前方に敵影（まだ戦闘ではない） |
| `in_progress` | **現在の戦闘相手** | 戦闘。常に1体（TodoWrite/update_plan とも in_progress は基本1個） |
| `completed` | 撃破済み | 倒した跡 |

**探検（field）が消えない設計** [決定]：
- `in_progress` が無い瞬間＝探検。具体的には ①プロンプト→最初の TODO 生成までの下調べ、
  ②1体 completed → 次が in_progress になるまでの間。
- 探検を意図的に確保する2点：
  1. 撃破直後に次戦闘へ即スナップさせない。completed→次 in_progress の間に「歩く間」を必ず一拍入れる。
     （現行コードの `field_restored` 演出を、見える長さに育てる）
  2. 下調べ窓（最初の TODO 前）をダンジョン入口の探索に当てる。
- 探検は長さより対比。尺は短くてよい。

**TODO無しセッションの方針 [決定：(a) 割り切り]**：TodoWrite/update_plan を一度も使わない
セッションではモンスターが一切湧かない＝戦闘ゼロ。短いタスクや plan を使わない時に該当。
→ **「TODO無し＝平和な探検」として割り切る**を採用。別の敵ソース（保険）は持たない。
- 理由：フォールバック禁止の原則に沿う。エラーを敵にする旧モデルの偽陽性地獄に戻らない。
  ゲームが一番生きるのは複数ステップの計画作業中で、短いタスクは平和な散歩、という割り切り。
- 挙動（実装で確認・テスト済み）：街→フィールド探検（PreToolUse/PostToolUse は `step`＝前進）→
  Stop で complete。戦闘フェーズに入らない。reducer はこの通り動く（追加実装なし）。
- 正直な代償：TodoWrite/update_plan を使わないセッションは戦闘が一切起きず地味になる
  （実際の Claude/Codex セッションは TODO 無しも多い）。これは選択の結果であり穴ではない。
  将来もし物足りなければ「TODO無し時のみの別敵ソース」を**明示的に**足す余地はある（今は入れない）。

その他のエッジ [未決定]：
- completed されずに項目がリストから消える（TODO 組み替え）→ モンスター逃走/消滅。
- in_progress → pending に戻る（後回し）→ 戦線離脱、フィールドへ。

---

## 3. 戦闘モデル [決定]

### HP は演出のみ・殺傷力なし
- HP＝「どれだけ手を入れたか」のゲージ。**HP では殺せない。**
- HP が0に達しても、その TODO が in_progress のままなら **瀕死ステート**：片膝をつき、
  わずかなHPでしがみつく。以後の攻撃は「よろける→立ち上がる」。バーは0付近に張り付く。
  （HP0→全回復→また0 の「ヨーヨー」は禁止。ダメージを0に漸近させて回避するのが推奨）
- 体感の狙い：「直った…と思ったらまだ落ちる」を表現する。チェックが付くまで死なない敵。

### トドメ＝TODO 項目が completed になった時 [決定]
- 撃破の唯一のトリガーは status が `completed` に変化した瞬間。
- 残HP無視で必殺フィニッシュ。短い項目で HP が大量に残っていても、completed が来たら一気に撃破。
  撃破は常に派手でよい。

### 攻撃＝ツールフック
- **PreToolUse → 通常攻撃**（振りかぶり）。
- **PostToolUse → スキル攻撃。技名＝ツール名**（例：「Editの斬撃」「Grepの探索」）。
- 1ツール呼び出し＝通常→スキルの2連撃コンボ。
- **PostToolUse は成功/失敗で技の結果を割る** [決定]：
  - 成功 → 技が決まる、in_progress モンスターにHPダメージ（演出）。
  - 失敗 → 技が外れる/暴発 → **敵の反撃**（新モンスターは湧かさない。失敗の行き場は戦闘内反撃）。
- 技名＝ツール名はプロバイダで品揃えが違う（後述）。未知ツールは生のツール名をそのまま技名に出す
  （握りつぶして通常攻撃に丸めない）。表示名マップは任意。

---

## 4. 使うフック：共通縛り [決定]

**Claude と Codex の両方に存在するフックだけで作る。** 共通集合＝Codex の全10種（すべて Claude にも存在）。

`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PermissionRequest` / `PostToolUse` /
`PreCompact` / `PostCompact` / `SubagentStart` / `SubagentStop` / `Stop`

| hook | フェーズ | 割り当て |
|---|---|---|
| SessionStart | 待機 | 拠点起動・状態ロード・BGM=town |
| UserPromptSubmit | 待機→探検 | クエスト受注、フィールドへ、BGM=field、ターン開始 |
| PreToolUse | 探検/戦闘 | 通常攻撃（前振り） |
| PermissionRequest | 保留 | 足止め「!」、判断待ちの硬直 |
| PostToolUse | ★中核 | スキル攻撃＋名簿更新＋成否分岐（下記） |
| PreCompact | 演出 | 「記憶が霞む／霧」長期戦の区切り |
| PostCompact | 演出 | 「霧が晴れる」名簿を再同期 |
| SubagentStart | 戦闘 | 仲間召喚／別働隊出撃 |
| SubagentStop | 戦闘 | 仲間帰還 |
| Stop | →待機 | 一区切り。未完了TODO無ければ街へ、有れば戦線維持 |

**PostToolUse の中の分岐：**
- `tool_name` が TODOツール（後述）→ **モンスター名簿を更新**（pending/in_progress/completed を反映、撃破判定）。
- 失敗 → 反撃。成功 → ダメージ/前進。

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

要決定 [未決定]：Codex の失敗→反撃をどうするか。
(a) **Claude のみ反撃／Codex は失敗不可視**で割り切る（推奨・正直）。
(b) `tool_response` の stderr テキストをヒューリスティック判定（＝廃止した単語マッチの再来。かつ
    exit≠0 でも stderr 無し（silent fail）は取れない。非推奨）。
(c) payload の `transcript_path`（rollout jsonl）を読んで成否を取る（重い・脆い・将来検討）。

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

## 8. 宿題（未着手の調査）

1. **[完了] Claude `TodoWrite` の payload 形を実機確認。** → §6 検証済。
   `tool_input = { todos: [{content, status, activeForm}] }`、status は3状態。reducer の仮定は正しかった。
2. **[完了・結論=impossible] Codex の非Bash／Bash 失敗フィールド。** → §7.2 で実機検証。
   結論：**Codex の hook payload はツールの成否を一切露出しない。** 失敗 Bash も exit code 無し、
   失敗 apply_patch は PostToolUse 自体が出ない。よって Codex の「失敗→反撃」は hook から不可能。
   §5 の「要決定」(a)/(b)/(c) を参照。現実装は (a)（Codex 失敗は不可視＝成功扱い）。
3. **[完了] TODO無しセッションの方針** → §2 で (a) 割り切り（TODO無し＝平和な探検、保険の敵ソースなし）に決定。実装・テスト済み。

→ **§8 の宿題は全て解消。** 残りは画像/演出（Codex 側）と目視確認のみ。

---

## 9. 実装ステータス（2026-06-05 更新）

- **reducer：実装済み・検証済み。** `server/adventure-state.mjs` を新モデルに全面書換。
  - 旧 `detectFailure` の単語マッチ正規表現は廃止。exit code ＋明示エラーフラグのみ。
  - PostToolUse で `tool_name ∈ {TodoWrite, update_plan}` を拾い、status 差分で
    spawn(pending)/engage(in_progress)/kill(completed) を駆動。
  - 失敗信号は A案（Claude=PostToolUseFailure イベント / Codex=PostToolUse payload の exit code）→ `counter`。
  - HP は演出専用（HP_FLOOR=1 で殺せない、瀕死=dying）。トドメは completed のみ。
  - PreToolUse=通常攻撃 / PostToolUse=スキル攻撃（技名＝ツール名）。
- **テスト：12/12 pass。** `test/adventure-state.test.mjs`（偽陽性修正・HP で殺せない・completed トドメ・provider parity 等）。
- **サーバ経由の E2E スモーク：確認済み。** 一時 PROJECT_DIR＋別ポートで `/hook`→`/state`→effects を実行し、
  TodoWrite→battle、Edit→attack(skill)、PostToolUseFailure→counter、completed→monster_defeated(finisher)+次の engage を確認。
- **フロントエンド：新 state/effect に配線済み（ビジュアルは仮）。**
  - `public/overlay.html` / `overlay.js` / `overlay.css`：target=in_progress を戦闘相手に、pending を待機列(`#roster`)に、
    TODO 本文を `#monsterLabel` に表示。新 effect（engage/attack(kind,skill)/counter/monster_dying/monster_defeated(finisher)/
    monster_fled/retreat/turn_completed/ally_*/compact_*/hold）をトースト＋パーティクル＋フラッシュで仮表示。瀕死は点滅。
  - `public/app.js`（Web ビュー）：`progress`/`errorsDefeated` 廃止に追従、target/defeatedCount/label に対応、新 effect 対応。
  - **未着手：** 画像・スプライト・凝った演出（Codex 側で対応予定）。`scripts/demo.mjs` は旧イベント形式のまま。
    `.rpgdev/state.json` は旧形式が残るので実起動前に `/control/reset` 推奨。
- 実機検証の生データ：`tmp/codex-probe/`（gitignore 対象、`hook-capture.log` / `probe*-events.jsonl`）。
  ※ 検証中に `~/.codex/auth.json` を `tmp/codex-home/` にコピーしたが、機密のため削除済み。
