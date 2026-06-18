# リリース手順（npm publish）

最終更新: 2026-06-18。**rpgdev は 2026-06-05 に npm 初公開済み（v0.1.0）。**
ここに書いてあるのは「次回以降どう publish するか」と「初回でハマった罠（再発防止のための記録）」。

---

## 通常の更新（2回目以降）= これが普段の手順

パッケージは既に npm に存在するので、更新は **トークンで publish できる**（初回のような OTP は不要）。

> **⚠ 訂正（2026-06-07 解決）**：Claude（自動）から publish するには、実際には **classic Automation トークン ＋
> パッケージ側 `Publishing access = Require two-factor authentication or automation tokens`（`mfa=automation`）** の
> 両方が必要だった。**granular トークンや 2FA 無効化では通らない**。`~/.npmrc` に classic automation トークンを入れた状態で
> `npm whoami` が通れば OK（granular だと 401 になる）。以下の granular 記述は初期の試行錯誤の記録として残す。

1. バージョンを上げる（`package.json` の `version`）。pre-1.0 なので、モデル変更など大きいものは **minor**（0.1.0 → 0.2.0）、小修正は patch。`npm version patch|minor` でもよい（git タグも自動で作る）。
2. テスト: `npm test`
3. 公開内容の確認（任意）: `npm pack --dry-run`（認証不要、同梱ファイル一覧が出る）
4. 公開: `npm publish --access public`
   - 認証は `~/.npmrc` の `//registry.npmjs.org/:_authToken=<トークン>` を使う。
   - **Claude に実行させる場合**、`.claude/settings.local.json` の `permissions.allow` に `Bash(npm publish:*)` が必要（`.claude/` は gitignore 対象なので、無ければ足す）。これが無いと auto-mode 分類器が publish をブロックする。
5. 確認: `npm view rpgdev version`

> **⚠ 公開後に Windows のグローバルを更新するときは Windows の作業ディレクトリから。** 挙動確認のため
> `npm i -g rpgdev@<ver>` を Windows 側でも更新するが、`powershell.exe npm i -g` を WSL から叩くと cwd が
> `\\wsl.localhost\...` の UNC になり、Windows の npm が WSL 側の `~/.npmrc`（Linux 用 `prefix`）を project config
> として読み込んで `prefix cannot be changed from project config` で失敗する（**404 として表面化**して紛らわしい）。
> 必ず Windows のパスから実行する：`powershell.exe -Command 'Set-Location $env:USERPROFILE; npm i -g rpgdev@<ver>'`。
> WSL 側のグローバルは WSL から普通に `npm i -g` でよい（両方更新が要る＝Windows ネイティブと WSL2 で別グローバル）。

---

## トークン設定（~/.npmrc）

- **granular access token（bypass 2FA 有効）** を使う。npmjs.com → Access Tokens → Granular → 「Bypass 2FA」を ON、Packages は rpgdev に **Read and write**。
- npmjs.com → rpgdev → Settings → Publishing access を **「Require two-factor authentication or granular access token with bypass 2FA」** にしておく（トークン publish を許可する設定）。
- `~/.npmrc` への設定は、トークンを**履歴・チャット・ログに残さない**やり方で：
  ```bash
  read -rs TOK && npm config set //registry.npmjs.org/:_authToken="$TOK" && unset TOK
  ```
  → 何も表示されない状態で **`npm_` で始まる本体だけ** を貼る。
  - ⚠ npmjs サイトからコピーすると**トークンの「名前/ラベル」まで一緒にコピーしがち**。ラベル混入だと
    `Bearer <ラベル> npm_xxx is not a legal HTTP header value` で失敗する。値だけにする。

---

## ⚠ 初回 publish の罠（v0.1.0 で時間を溶かした原因。もう再発しないが記録）

新規パッケージの**初回 publish だけ**は特殊で、ここでハマった：

- **npm の granular access token は「まだ存在しないパッケージ」を作成できない。**
  初回 publish は `PUT https://registry.npmjs.org/rpgdev` が **404**（`could not be found or you do not have permission`）になる。
  `npm whoami` も granular トークンだと **401**（これは granular の正常挙動。トークンが壊れているわけではない）。
- Classic automation token なら新規作成できるが、**npm が Classic トークンを廃止中**。
- → **初回（新規パッケージの箱作り）だけは、対話 `npm login` + OTP で publish する**必要があった。
  ```bash
  npm login
  npm publish --access public   # OTP を入力
  ```
- **箱ができた今、この罠は再発しない。** 2回目以降は上の「通常の更新」手順（トークンで OK）。
- 参考: [npm/cli #5089](https://github.com/npm/cli/issues/5089)、[Classic token 廃止](https://github.com/orgs/community/discussions/179562)。

---

## メモ

- パッケージサイズは約 89MB（2026-06-15・v0.5.6 時点の `npm pack --dry-run` で 89.3MB／76ファイル）。
  `public/audio/*.wav`（dungeon/castle BGM を含む7トラック）と `public/assets/*.png`（ステージ別モンスター）が主因。
  精霊スプライトや再生成 BGM を追加した時は `npm pack --dry-run` で同梱サイズを確認する。軽量化するなら別バージョンで。
- `public/assets/sprites/` の画像生成デバッグ/作業ファイルは同 dir の `.gitignore` 許可リスト（採用スプライトだけ `!` で通す）で
  git・npm 双方から除外している。**新しいスプライトを採用したら `.gitignore` に `!name.png` 行を足す**（足さないと同梱されない）。
- `docs/` と `CLAUDE.md` は `package.json` の `files` に無いので npm には同梱されない（dev 用なので正しい）。
- GitHub のタグと揃えるなら `git tag vX.Y.Z && git push origin vX.Y.Z`。
