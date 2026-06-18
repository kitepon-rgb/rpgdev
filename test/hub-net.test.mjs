import test from "node:test";
import assert from "node:assert/strict";
import {
  hubBindHost,
  hubReachHost,
  parseDefaultGateway,
  winHubDirFromLocalAppData,
  HUB_WINDOW_HOST
} from "../scripts/hub-net.mjs";

// 単一ハブの住所解決（純関数）。実環境を読まないよう platform / env / 注入値を必ず渡す。

test("parseDefaultGateway: `ip route show default` からゲートウェイ IPv4 を抽出", () => {
  assert.equal(parseDefaultGateway("default via 172.28.128.1 dev eth0 proto kernel \n"), "172.28.128.1");
});

test("parseDefaultGateway: 複数行でも最初の default 行から拾う", () => {
  const text = "10.0.0.0/8 dev eth0\ndefault via 192.168.1.1 dev eth0\n";
  assert.equal(parseDefaultGateway(text), "192.168.1.1");
});

test("parseDefaultGateway: default 行が無ければ null", () => {
  assert.equal(parseDefaultGateway("10.0.0.0/8 dev eth0 scope link"), null);
  assert.equal(parseDefaultGateway(""), null);
  assert.equal(parseDefaultGateway(undefined), null);
});

test("winHubDirFromLocalAppData: …\\rpgdev\\hub を作る（末尾区切りは正規化）", () => {
  assert.equal(winHubDirFromLocalAppData("C:\\Users\\kite_\\AppData\\Local"), "C:\\Users\\kite_\\AppData\\Local\\rpgdev\\hub");
  assert.equal(winHubDirFromLocalAppData("C:\\Users\\kite_\\AppData\\Local\\"), "C:\\Users\\kite_\\AppData\\Local\\rpgdev\\hub");
});

test("HUB_WINDOW_HOST: 窓は常に同ホスト＝127.0.0.1", () => {
  assert.equal(HUB_WINDOW_HOST, "127.0.0.1");
});

test("hubBindHost: win32 / wsl は 0.0.0.0（localhost と WSL アダプタ IP の両方で受ける）", () => {
  assert.equal(hubBindHost({ env: {}, platform: "win32" }), "0.0.0.0");
  assert.equal(hubBindHost({ env: {}, platform: "wsl" }), "0.0.0.0");
});

test("hubBindHost: darwin / linux は 127.0.0.1（非 WSL は不変）", () => {
  assert.equal(hubBindHost({ env: {}, platform: "darwin" }), "127.0.0.1");
  assert.equal(hubBindHost({ env: {}, platform: "linux" }), "127.0.0.1");
});

test("hubBindHost: RPGDEV_HOST 明示は常に最優先", () => {
  assert.equal(hubBindHost({ env: { RPGDEV_HOST: "10.1.2.3" }, platform: "win32" }), "10.1.2.3");
  assert.equal(hubBindHost({ env: { RPGDEV_HOST: "127.0.0.1" }, platform: "wsl" }), "127.0.0.1");
});

test("hubReachHost: win32 は 127.0.0.1（ハブは同ホスト）", () => {
  assert.equal(hubReachHost({ env: {}, platform: "win32" }), "127.0.0.1");
});

test("hubReachHost: darwin / linux は 127.0.0.1", () => {
  assert.equal(hubReachHost({ env: {}, platform: "darwin" }), "127.0.0.1");
  assert.equal(hubReachHost({ env: {}, platform: "linux" }), "127.0.0.1");
});

test("hubReachHost: wsl は既定ゲートウェイ。取れなければ明確に throw", () => {
  assert.equal(hubReachHost({ env: {}, platform: "wsl", ipRouteText: "default via 172.28.128.1 dev eth0" }), "172.28.128.1");
  assert.throws(() => hubReachHost({ env: {}, platform: "wsl", ipRouteText: "" }), /could not determine the Windows host IP/);
});

test("hubReachHost: RPGDEV_HOST 明示は常に最優先（wsl でもゲートウェイ解決を飛ばす）", () => {
  assert.equal(hubReachHost({ env: { RPGDEV_HOST: "10.1.2.3" }, platform: "wsl" }), "10.1.2.3");
});
