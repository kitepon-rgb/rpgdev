// フック設定を利用者の設定ファイルへ「安全に自動書込」する（`rpgdev setup --apply`）。
// 思想：できるだけスクリプトに任せる。ただし安全にできないと判断したら書かずに理由を返し、AI/人に委ねる。
// 安全規則（docs/install-hooks.md と同一）：
//   - 触るのは `.hooks` だけ（permissions/env/model/mcpServers 等は不変）。
//   - 各イベントは既存を残して追記。`_rpgdev` マーカー付きエントリが既にあればパスだけ更新（冪等）。
//   - 既存が不正 JSON / 想定外の形状なら**書かずに中止**して理由を返す（壊さない）。
//   - 書く前に原本をバックアップ（`*.rpgdev-bak`。既にあれば原本を上書きしない＝最初の原本を保持）。
//   - 一時ファイルへ書いて rename（アトミック＝途中クラッシュで設定を切り詰めない）。
import { readFile, writeFile, rename, copyFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { RPGDEV_MARKER } from "./hook-config.mjs";

// 純関数：既存設定オブジェクトへ config.hooks をマージし {merged, added, updated} を返す。
// buildHookConfig は1イベント＝1ラッパ（{matcher?, hooks:[entry]}）を出す。既存配列の中から
// rpgdev マーカーを持つラッパを探し、あれば差し替え（パス更新＝冪等）、無ければ追記する。
export function mergeHooks(existing, config) {
  const merged = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const baseHooks =
    merged.hooks && typeof merged.hooks === "object" && !Array.isArray(merged.hooks) ? { ...merged.hooks } : {};
  let added = 0;
  let updated = 0;
  for (const [event, wrappers] of Object.entries(config.hooks)) {
    const incoming = wrappers[0];
    const list = Array.isArray(baseHooks[event]) ? baseHooks[event].slice() : [];
    const idx = list.findIndex(
      (w) => w && Array.isArray(w.hooks) && w.hooks.some((h) => h && h._rpgdev === RPGDEV_MARKER)
    );
    if (idx >= 0) {
      list[idx] = incoming;
      updated += 1;
    } else {
      list.push(incoming);
      added += 1;
    }
    baseHooks[event] = list;
  }
  merged.hooks = baseHooks;
  return { merged, added, updated };
}

// I/O：対象ファイルを安全に読んでマージし、バックアップ＋アトミック書込する。
// 戻り値は AI が「自動で済んだ／人手が要る」を判断できる形（applied / reason）。
export async function applyHookConfig(targetPath, config) {
  let existing = {};
  let fileExisted = false;
  try {
    const raw = await readFile(targetPath, "utf8");
    fileExisted = true;
    if (raw.trim()) {
      try {
        existing = JSON.parse(raw);
      } catch {
        return {
          applied: false,
          reason: `existing file is not valid JSON: ${targetPath} — merge by hand (see docs/install-hooks.md).`
        };
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      return { applied: false, reason: `cannot read ${targetPath}: ${error.message}` };
    }
  }
  if (existing && (typeof existing !== "object" || Array.isArray(existing))) {
    return { applied: false, reason: `existing file is not a JSON object: ${targetPath} — merge by hand.` };
  }
  // これから触るイベントの既存値が配列でない＝想定外スキーマなら、壊さず中止して委ねる。
  if (existing.hooks && typeof existing.hooks === "object") {
    for (const event of Object.keys(config.hooks)) {
      if (event in existing.hooks && !Array.isArray(existing.hooks[event])) {
        return {
          applied: false,
          reason: `existing .hooks.${event} is not an array (unexpected shape) in ${targetPath} — merge by hand.`
        };
      }
    }
  }

  const { merged, added, updated } = mergeHooks(existing, config);
  await mkdir(dirname(targetPath), { recursive: true });

  let backupPath = null;
  if (fileExisted) {
    backupPath = `${targetPath}.rpgdev-bak`;
    try {
      await access(backupPath, constants.F_OK); // 既にある＝最初の原本。上書きしない。
    } catch {
      await copyFile(targetPath, backupPath);
    }
  }

  const tmp = `${targetPath}.rpgdev-tmp`;
  await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await rename(tmp, targetPath);
  return { applied: true, targetPath, backupPath, added, updated };
}
