// 単一ハブの「住所」を用途別に1か所で決めるモジュール。
// Windows / WSL2 では rpgdev サーバ（ハブ）を Windows ホスト上に1つだけ立て、全インターフェース(0.0.0.0)で
// 待ち受ける。物理 NIC は Windows Defender の既定遮断で露出せず、WSL vEthernet（inbound 許可ルール）と
// localhost だけが通る＝実質ホスト/WSL 限定。窓は同ホスト上なので localhost で繋ぎ、WSL2 のフックは
// WSL アダプタ IP（既定ゲートウェイ）経由で同じ1つのハブへ届く（docs/02_windows-wsl.md「単一 Windows ハブ」）。
//
// 用途別の住所（混ぜると壊れるので分ける）：
//   hubBindHost     … サーバが listen するアドレス（RPGDEV_HOST env に渡す）。win32/wsl=0.0.0.0。
//   hubReachHost    … このプロセスからハブへ到達する宛先（フック送信・起動確認）。wsl=ゲートウェイ。
//   HUB_WINDOW_HOST … 窓(WebView2)が繋ぐ先。常に同ホスト＝127.0.0.1（実機で、ホスト自身の WSL アダプタ IP
//                      相手だと WebView2 のリアルタイム配信(SSE)が通らなかったため localhost 固定）。
//
// パース関数（parseDefaultGateway）は純関数で、test/hub-net.test.mjs が直接検証する。
import { execSync } from "node:child_process";
import { detectPlatform } from "./desktop-platform.mjs";

// ポートは単一サービスなので従来通り 37373 固定（RPGDEV_PORT で上書き可）。
export const HUB_PORT = Number(process.env.RPGDEV_PORT || 37373);

// 窓の単一インスタンスキー（Windows C# named Mutex 名）は固定グローバル値。
// 環境/プロジェクトをまたいで窓を必ず1つにする（2 つ目の起動は既存窓を前面化するだけ）。
export const HUB_INSTANCE_KEY = "rpgdev-hub";

// 窓は必ずハブと同じ Windows ホスト上で動くので、接続先は常にループバック。
// ホスト上の WebView2 は localhost への接続/SSE は確実に通るが、ホスト自身の WSL アダプタ IP 相手だと
// リアルタイム配信が通らない実機事例があったため、窓は localhost 固定とする（サーバは 0.0.0.0 で受ける）。
export const HUB_WINDOW_HOST = "127.0.0.1";

// `ip route show default` のテキストから既定ゲートウェイ IPv4 を抽出する純関数。
// 例: "default via 172.28.128.1 dev eth0 proto kernel" → "172.28.128.1"。
export function parseDefaultGateway(text) {
  const match = /default\s+via\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(String(text || ""));
  return match ? match[1] : null;
}

// %LOCALAPPDATA% から単一グローバルハブの Windows ディレクトリ（…\rpgdev\hub）を作る純関数。
export function winHubDirFromLocalAppData(localAppData) {
  return `${String(localAppData).replace(/[\\/]+$/, "")}\\rpgdev\\hub`;
}

// サーバが listen するアドレス。
//   win32 / wsl   : 0.0.0.0（localhost と WSL アダプタ IP の両方で受ける。物理 NIC は FW 既定遮断で露出せず）
//   darwin / linux: 127.0.0.1（非 WSL 環境は不変）
// RPGDEV_HOST が明示されていれば常にそれを優先（上書き口）。
export function hubBindHost(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.RPGDEV_HOST) return env.RPGDEV_HOST;
  const platform = opts.platform ?? detectPlatform();
  return platform === "win32" || platform === "wsl" ? "0.0.0.0" : "127.0.0.1";
}

// このプロセスからハブへ到達する宛先（フック送信・起動確認に使う）。
//   win32         : 127.0.0.1（ハブは同ホスト）
//   wsl           : 既定ルートのゲートウェイ＝ホストの WSL アダプタ IP（WSL2 → ホストのハブ）
//   darwin / linux: 127.0.0.1
// RPGDEV_HOST が明示されていれば常にそれを優先（上書き口）。
export function hubReachHost(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.RPGDEV_HOST) return env.RPGDEV_HOST;
  const platform = opts.platform ?? detectPlatform();
  if (platform === "wsl") {
    const text = opts.ipRouteText ?? readDefaultRouteText();
    const gateway = parseDefaultGateway(text);
    if (!gateway) {
      throw new Error(
        "WSL2: could not determine the Windows host IP (no default gateway from `ip route show default`). " +
          "The hub runs on the Windows host; set RPGDEV_HOST to the host's WSL-adapter IP to override."
      );
    }
    return gateway;
  }
  return "127.0.0.1";
}

function readDefaultRouteText() {
  try {
    return execSync("ip route show default", { encoding: "utf8" });
  } catch {
    return "";
  }
}
