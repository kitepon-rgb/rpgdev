# RPGDev 再設計メモ：ランダムエンカウント モデル

最終更新: 2026-06-06
ステータス: **実装済み・検証済み**。現行コードは ランダムエンカウント モデルへ移行済み。
このドキュメントは、設計判断・実機調査・実装ステータスの単一の記録。

モデルは「エラー＝モンスター」→「TODO＝モンスター」→「ランダムエンカウント」と変遷した（最新は本ドキュメントの記述）。

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
BGM トラック（`currentTrack`）は `field` / `adventure` / `battle`。

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

## 3. 戦闘モデル [決定]

### モンスター＝ランダムエンカウント
- モンスターは TODO からは湧かない。**PreToolUse ごとに 20% の確率で1体だけ出現**する（2体同時は無い）。
- スプライト/HP は `MONSTER_CATALOG`（Slime/Goblin/Orc/Ogre）からランダム。HP は演出専用で殺傷力なし。
- 出現時に `linkedTodo` フラグを決める：出現時に in_progress の TODO があれば `linkedTodo=true`、無ければ `false`。

### 討伐条件＝linkedTodo で分岐 [決定]
- **`linkedTodo=false`（TODO 不在で出現）**：hero の攻撃 **5回** で討伐、または **ターン終了（Stop）** で討伐。
- **`linkedTodo=true`（in_progress TODO 中に出現）**：攻撃では倒れない。
  **TODO 項目が1つ `completed` になった時に討伐**する。
  in_progress TODO が無くなったら `linkedTodo` は解除され、その後は通常の 5撃／ターン終了で倒せる。
- HP は演出専用で、HP では討伐しない（上の条件のみで討伐）。

### 攻撃＝ツールフック（1 Hook = 1 アクション）[決定]
- **1つの Hook では「出現 / 召喚 / 攻撃 / 前進」のいずれか1つだけ**を実行する（出現→攻撃→召喚を同一 Hook で連鎖させない＝演出上の違和感を排除）。
- **PreToolUse**：敵不在なら 20% で出現（出たらそれだけ／出なければ前進）。敵在席なら 20% で精霊増援（召喚したらそれだけ）／召喚しなければ通常攻撃（`NORMAL_DAMAGE`, 演出）。
- **PostToolUse → スキル攻撃。技名＝ツール名**（`SKILL_DAMAGE`, 演出, 例：「Editの斬撃」「Grepの探索」）。出現・増援の判定はしない（Pre のみ）。
- 攻撃も増援召喚も、敵（エンカウント）が居なければ起きない（敵不在 Hook は前進のみ）。トドメになった攻撃は、その帰結として撃破＋精霊退場を伴う（同一アクションの結果であり別アクションではない）。
- 技名＝ツール名はプロバイダで品揃えが違う（後述）。未知ツールは生のツール名をそのまま技名に出す
  （握りつぶして通常攻撃に丸めない）。表示名マップは任意。

### 失敗→反撃（counter）[決定]
- 失敗→敵の反撃。失敗信号は **Claude の `PostToolUseFailure` / `PermissionDenied` / 構造化された exit code 非0** のみ。
- `detectFailure` はイベント名と構造化フラグだけを見る（出力テキストの単語マッチは廃止＝§0/§5）。
- **Codex は失敗を payload に出さない**ので検知不能＝反撃しない（§5/§7）。

### 精霊（仲間 allies）[実装済み]
- 戦闘中、**ツール使用ごと（PreToolUse）に 20% で1体だけ増援**。さらに **SubagentStart でも1体参戦**。
- 常に1体ずつ追加し、**属性の重複は避ける**（火 `Ignis` / 地 `Terra` / 風 `Sylph` / 水 `Aqua`）。**上限4体**。
  `Aqua` は水精霊スプライト `ally-water-facing-slit.png` を使う。
- 在席中の精霊は現在の敵に**追撃する**（演出。`attack` effect, `kind:"ally"`, `allyId` 付き。討伐の 5撃にはカウントしない）。
- **モンスターを倒すたびに精霊は全員消滅**する（戦闘終了で退場）。
- `SubagentStop` で1体帰還（LIFO。hook payload が個体 id を持つとは限らないため）。
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
| PreToolUse | 探検/戦闘 | 通常攻撃（前振り）＋20% エンカウント出現判定＋戦闘中なら 20% 精霊増援判定 |
| PermissionRequest | 保留 | 足止め「!」、判断待ちの硬直 |
| PostToolUse | ★中核 | スキル攻撃＋クエスト一覧更新＋成否分岐（下記） |
| PreCompact | 演出 | 「記憶が霞む／霧」長期戦の区切り |
| PostCompact | 演出 | 「霧が晴れる」状態を再同期 |
| SubagentStart | 戦闘 | 精霊が1体参戦（`state.allies` に追加）。戦闘中は hero 攻撃に追撃（§3 精霊） |
| SubagentStop | 戦闘 | 精霊が帰還（LIFO で1体離脱） |
| Stop | →待機 | ターン終了。linkedTodo=false の在席エンカウントを討伐。未完了TODO無ければ街へ |

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

## 9. 実装ステータス（2026-06-06 更新・ランダムエンカウント モデル）

- **reducer：実装済み・検証済み。** `server/adventure-state.mjs` をランダムエンカウント モデルへ。
  - 旧 `detectFailure` の単語マッチ正規表現は廃止。Claude の失敗イベント名（PostToolUseFailure/PermissionDenied）と
    構造化 exit code 非0 のみ → `counter`。実機 Codex は失敗不可視なので成功扱い（反撃しない）。
  - **モンスターは TODO からは湧かない。** PreToolUse ごとに 20% でエンカウントが1体だけ出現（最大1体）。
    スプライト/HP は `MONSTER_CATALOG`（Slime/Goblin/Orc/Ogre）からランダム。HP は演出専用。
  - 出現時に `linkedTodo` を決定（出現時 in_progress TODO あり=true / なし=false）。討伐条件はこのフラグで分岐：
    - `linkedTodo=false` → hero の攻撃 **5撃**、または **ターン終了（Stop）** で討伐。
    - `linkedTodo=true` → 攻撃では倒れず、TODO が1つ `completed` になった時に討伐。in_progress TODO が消えたら `linkedTodo` 解除。
  - TODO ツール（`tool_name ∈ {TodoWrite, update_plan}`）は `state.quest`（label+status のスナップショット）を更新するだけ。
    新たに completed になった項目があれば紐づくエンカウントを討伐。
  - PreToolUse=通常攻撃 / PostToolUse=スキル攻撃（技名＝ツール名）。出現・増援の判定は PreToolUse のみ。
  - **1 Hook = 1 アクション**：1つの Hook では出現/召喚/攻撃/前進のいずれか1つだけ（同一 Hook で連鎖しない）。
  - **TODO 未発生時はユーザー入力を1つの合成クエスト(`synthetic`, in_progress)として表示**し、TodoWrite で本物に置換。synthetic は表示専用で linkedTodo に数えない。
  - 精霊：戦闘中の PreToolUse ごとに 20% で1体増援＋SubagentStart で1体参戦。属性重複回避（火/地/風/水）・上限4体。
    在席中は現在の敵に追撃（`attack` kind:"ally"、討伐の5撃には数えない）。
    モンスター討伐ごとに精霊は全員消滅。SubagentStop で1体帰還（LIFO）、在席ゼロでの Stop は無反応。
- **テスト：19/19 pass。** `test/adventure-state.test.mjs`（失敗検知の偽陽性修正・ランダムエンカウント出現・5撃討伐・
  ターン終了討伐・linkedTodo の completed 討伐・provider parity・精霊 増援/参戦/重複回避/上限4/追撃/討伐で消滅/離脱 等）。
- **フロントエンド：新 state/effect に配線済み。**
  - `public/overlay.html` / `overlay.js` / `overlay.css`：エンカウントのモンスターを画面中央の戦闘相手に、
    在席精霊を属性ごとの定位置に、現在の敵ラベルを表示。新 effect（monster_appeared/attack(kind,skill,ally)/counter/
    monster_defeated/turn_completed/turn_blocked/ally_summon/ally_return/compact_pre/compact_post/hold/step 等）を
    トースト＋パーティクル＋フラッシュで表示。
    通常/スキル攻撃は斬撃・揺れ・技名カットイン付き。瀕死点滅・画面全体の赤点滅・「よろけ」表示は廃止。
  - **演出の直列化**：攻撃/リアクションのアニメは全体共通の単一キューで直列化。常に1体ずつ再生し、
    1つ終わってから **0.1秒** 空けて次へ。出現/召喚/帰還/クリア等の即時演出はキューを占有しない。詰まり防止に攻撃アニメは最大10件で間引く。
  - **クエストトラッカー UI**：MMO ミッション風パネルを画面中央上に表示。未着手 ◇ / 進行中 ◆ / 達成 ✓。
    全項目完了 or idle では非表示。
  - **ヘッダーは1行**：「RPGDev ◆ <フェーズ>」。RPGDev は金グラデのゲームタイトル（フェーズ名と同サイズ、菱形セパレータ）。ヘッダー高 60px。
  - **戦闘配置**：勇者は左下（戦闘時 +10%）、モンスター中央（-20%）、精霊は属性ごとに固定（水=左上, 風=右上, 火=右端・下げ気味, 地=中央下）。モンスター名は1.7倍。
  - 仲間精霊スプライトを追加：火/地/風/水。`Aqua`（水）は `ally-water-facing-slit.png`。
  - `public/app.js`（Web ビュー）：新 state/effect に追従（精霊含む）。
  - `adventure.wav` / `battle.wav` は `scripts/render-bgm.mjs` の更新から再生成済み。
  - フロント変更を窓に反映するには WKWebView のリロード（窓の開き直し）が必要。
- 実機検証の生データ：`tmp/codex-probe/`（gitignore 対象、`hook-capture.log` / `probe*-events.jsonl`）。
  ※ 検証中に `~/.codex/auth.json` を `tmp/codex-home/` にコピーしたが、機密のため削除済み。
