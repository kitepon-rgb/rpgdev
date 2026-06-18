// HTTP `Range` ヘッダ（単一の `bytes=` 範囲）を解釈する純関数。
// メディア要素（<audio>/<video>）は単一範囲しか送らないので 1 範囲だけ対応する。
//
// 戻り値:
//   null       … Range ヘッダ無し or 未対応形式 → 呼び出し側は全体を 200 で配信
//   "invalid"  … 構文上は範囲だがファイルを満たせない → 呼び出し側は 416 を返す
//   {start,end}… 有効な範囲（両端を含む 0-origin のバイト位置）
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    // 末尾 N バイト: bytes=-500
    const suffix = Number(match[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}
