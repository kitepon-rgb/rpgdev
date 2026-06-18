import test from "node:test";
import assert from "node:assert/strict";
import { parseRange } from "../server/http-range.mjs";

const SIZE = 1000;

test("Range ヘッダ無し → null（全体を 200 で配信）", () => {
  assert.equal(parseRange(undefined, SIZE), null);
  assert.equal(parseRange("", SIZE), null);
  assert.equal(parseRange(null, SIZE), null);
});

test("未対応形式 → null", () => {
  assert.equal(parseRange("bytes=abc", SIZE), null);
  assert.equal(parseRange("items=0-100", SIZE), null);
  assert.equal(parseRange("bytes=-", SIZE), null); // 両端空は無効指定＝範囲なし扱い
});

test("先頭からの範囲: bytes=0-1023 はファイル末尾でクランプ（両端含む）", () => {
  assert.deepEqual(parseRange("bytes=0-1023", SIZE), { start: 0, end: 999 });
});

test("明示範囲: bytes=100-199", () => {
  assert.deepEqual(parseRange("bytes=100-199", SIZE), { start: 100, end: 199 });
});

test("開始のみ: bytes=500- は末尾まで", () => {
  assert.deepEqual(parseRange("bytes=500-", SIZE), { start: 500, end: 999 });
});

test("末尾 N バイト: bytes=-200 は末尾 200 バイト", () => {
  assert.deepEqual(parseRange("bytes=-200", SIZE), { start: 800, end: 999 });
});

test("末尾 N がファイル超過: bytes=-5000 は先頭から", () => {
  assert.deepEqual(parseRange("bytes=-5000", SIZE), { start: 0, end: 999 });
});

test("満たせない範囲 → 'invalid'（416）", () => {
  assert.equal(parseRange("bytes=1000-2000", SIZE), "invalid"); // start >= size
  assert.equal(parseRange("bytes=2000-3000", SIZE), "invalid");
  assert.equal(parseRange("bytes=-0", SIZE), "invalid"); // 末尾 0 バイトは無効
});

test("前後の空白を許容", () => {
  assert.deepEqual(parseRange("  bytes=0-99  ", SIZE), { start: 0, end: 99 });
});
