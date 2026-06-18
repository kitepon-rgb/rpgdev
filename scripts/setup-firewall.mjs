#!/usr/bin/env node
// `rpgdev setup-firewall` — WSL2/Windows で「単一 Windows ハブ」を共有するのに必須の
// インバウンド許可（WSL2 → ホスト TCP <HUB_PORT>）を、**標準 Defender と Hyper-V の両層**で入れる。
//
// なぜ両層か：WSL2(nat) → ホストの通信は (a) 標準ホストファイアウォール と (b) Hyper-V ファイアウォール
// （WSL vmCreator、既定インバウンド Block）の両方を通る。片方でも Block なら届かない。
// なぜ再起動耐性か：標準規則をインターフェース（vEthernet (WSL)）で縛ると、`New-NetFirewallRule` は
// 作成時にエイリアスを **GUID へ解決して保存**する。WSL アダプタの GUID は再起動ごとに変わるため、
// 次回起動で規則が一致しなくなり遮断される（実機で踏んだ＝2026-06-18）。よって標準規則は
// **WSL NAT のリモート範囲 172.16.0.0/12 で縛る**（LAN/VPN は対象外・再起動でも不変）。
//
// 変更には管理者権限が要るので、適用は UAC（昇格）プロンプト経由＝ユーザー承認で行う。
// 昇格は端末(窓ステーション)を持つ前面プロセスからでないと UAC を表示できない＝stdio を継承して起動する。
import { spawn } from "node:child_process";
import { detectPlatform } from "./desktop-platform.mjs";
import { HUB_PORT } from "./hub-net.mjs";

const WSL_VMCREATOR = "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}"; // WSL の VMCreatorId（全機共通の固定値）
const HV_RULE = "RPGDevHubWSL"; // Hyper-V 規則名
const STD_RULE = "RPGDevHubHostInbound"; // 標準 Defender 規則名
const WSL_NAT_RANGE = "172.16.0.0/12"; // WSL NAT のソース範囲（再起動耐性のため interface でなくこれで縛る）

main().catch((error) => {
  console.error(`[rpgdev firewall] ${error.stack || error}`);
  process.exitCode = 1;
});

async function main() {
  const platform = detectPlatform();
  if (platform !== "wsl" && platform !== "win32") {
    console.log(`[rpgdev firewall] Not needed on ${platform} — the WSL2/Windows hub firewall step is only for Windows hosts.`);
    return;
  }

  const haveHyperV = (await ps("if (Get-Command New-NetFirewallHyperVRule -EA SilentlyContinue) {'yes'} else {'no'}")).out === "yes";

  // 既に両層が正しく入っているか（標準規則がインターフェース固定＝失効リスクでないか）を確認し、OK なら何もしない。
  const hyperOk = !haveHyperV || (await ps(`(Get-NetFirewallHyperVRule -Name '${HV_RULE}' -EA SilentlyContinue).Action`)).out === "Allow";
  const stdAction = (await ps(`(Get-NetFirewallRule -Name '${STD_RULE}' -EA SilentlyContinue).Action`)).out;
  const stdIf = (await ps(`(Get-NetFirewallRule -Name '${STD_RULE}' -EA SilentlyContinue | Get-NetFirewallInterfaceFilter).InterfaceAlias`)).out;
  const stdOk = stdAction === "Allow" && (stdIf === "Any" || stdIf === "");
  if (hyperOk && stdOk) {
    console.log(`[rpgdev firewall] Already configured (standard${haveHyperV ? " + Hyper-V" : ""}) for TCP ${HUB_PORT}. Nothing to do.`);
    return;
  }

  // WSL2 からは昇格(UAC)を表示できない（interop は端末/窓ステーションを持てず Start-Process -Verb RunAs が即失敗する）。
  // 無理に試さず、Windows 側で実行するよう明確に案内して終わる＝「権限の壁＝Windows 側の手作業」を AI/人が判断できる出力。
  if (platform === "wsl") {
    console.log(`[rpgdev firewall] Not configured yet — and WSL2 can't raise the admin (UAC) prompt this needs.`);
    console.log(`  Run this once ON THE WINDOWS HOST (it will ask for admin):  rpgdev setup-firewall`);
    console.log(`  Then WSL2 can reach the hub on TCP ${HUB_PORT}. If it still can't, a VPN kill-switch (e.g. NordVPN)`);
    console.log("  may be blocking it — allow LAN/local in the VPN, or run `wsl --shutdown` from Windows to refresh networking.");
    process.exitCode = 2; // 手作業が要る＝AI が分岐できるよう非ゼロ
    return;
  }

  console.log(`[rpgdev firewall] Allowing WSL2 -> host on TCP ${HUB_PORT} at both firewall layers (host-only, reboot-stable).`);
  console.log("  A Windows UAC prompt will appear — APPROVE it (firewall changes need admin).");

  const parts = [];
  // 標準 Defender 層：古い同名/インターフェース固定の規則を除去し、WSL NAT 範囲で縛り直す（再起動耐性）。
  parts.push(`Get-NetFirewallRule -DisplayName 'RPGDev hub*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue`);
  parts.push(`Remove-NetFirewallRule -Name '${STD_RULE}' -ErrorAction SilentlyContinue`);
  parts.push(
    `New-NetFirewallRule -Name '${STD_RULE}' -DisplayName 'RPGDev hub (WSL host inbound ${HUB_PORT})' ` +
      `-Direction Inbound -Action Allow -Protocol TCP -LocalPort ${HUB_PORT} -RemoteAddress ${WSL_NAT_RANGE} -Profile Any | Out-Null`
  );
  // Hyper-V 層：WSL vmCreator の既定 Block の例外を入れる（コマンドレットがある時だけ）。
  if (haveHyperV) {
    parts.push(`Remove-NetFirewallHyperVRule -Name '${HV_RULE}' -ErrorAction SilentlyContinue`);
    parts.push(
      `New-NetFirewallHyperVRule -Name '${HV_RULE}' -DisplayName 'RPGDev hub (WSL Hyper-V inbound ${HUB_PORT})' ` +
        `-Direction Inbound -VMCreatorId '${WSL_VMCREATOR}' -Protocol TCP -LocalPorts ${HUB_PORT} -Action Allow | Out-Null`
    );
  }
  const encoded = Buffer.from(parts.join("; "), "utf16le").toString("base64");
  await elevateRunAs(encoded);

  // 検証（規則の存在で確定）。
  const afterStd = (await ps(`(Get-NetFirewallRule -Name '${STD_RULE}' -EA SilentlyContinue).Action`)).out;
  const afterHyper = !haveHyperV ? "n/a" : (await ps(`(Get-NetFirewallHyperVRule -Name '${HV_RULE}' -EA SilentlyContinue).Action`)).out;
  if (afterStd === "Allow" && (afterHyper === "Allow" || afterHyper === "n/a")) {
    console.log(`[rpgdev firewall] Done — standard=${afterStd}${haveHyperV ? `, Hyper-V=${afterHyper}` : ""} for TCP ${HUB_PORT}.`);
    console.log("  If WSL2 still cannot reach the hub after this, a VPN kill-switch (e.g. NordVPN) may be blocking it —");
    console.log("  allow LAN/local network in the VPN app, or run `wsl --shutdown` from Windows to refresh WSL networking.");
  } else {
    console.error(`[rpgdev firewall] Rules not fully applied (standard=${afterStd || "missing"}, Hyper-V=${afterHyper}). UAC likely declined — re-run to retry.`);
    process.exitCode = 1;
  }
}

// 昇格して rule を入れる。UAC を画面に出すため stdio を端末へ継承する（pipe/console 無しだと自動拒否される）。
function elevateRunAs(encoded) {
  return new Promise((resolveElevate) => {
    const command = `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`;
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { stdio: "inherit" });
    child.on("error", () => resolveElevate(false));
    child.on("close", (code) => resolveElevate(code === 0));
  });
}

// powershell.exe を1回叩いて stdout を返す（WSL は interop、win32 は直接）。
function ps(command) {
  return new Promise((resolvePs) => {
    let out = "";
    let err = "";
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (err += chunk.toString("utf8")));
    child.on("error", (error) => resolvePs({ ok: false, out: "", err: String(error.message || error) }));
    child.on("close", (code) =>
      resolvePs({ ok: code === 0, out: out.replace(/\r/g, "").trim(), err: err.replace(/\r/g, "").trim() })
    );
  });
}
