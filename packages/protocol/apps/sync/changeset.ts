import type { ChangesetCell } from "../../../base/changeset-invert.ts";

export {
  type ChangesetCell,
  type ChangesetChange,
  type ChangesetValue,
  readChangeset,
} from "../../../base/changeset-invert.ts";

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  return new Uint8Array(out);
}

// SQLite varint: 7 bit씩 앞에서부터, 이어지면 높은 bit를 켠다. 길이만 담아서 2^56 아래면 된다.
function varint(n: number): number[] {
  const groups: number[] = [];
  do {
    groups.unshift(n % 128);
    n = Math.floor(n / 128);
  } while (n > 0);
  return groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g));
}

const BYTE = BigInt(256);

/**
 * clock 표의 `pk` 칸: PK 칸들의 값을 changeset과 같은 부호로 칸 순서대로 이은 것.
 * Node와 폰에서 같은 bytes가 나온다(spike가 두 쪽의 clock dump가 같음을 봤다).
 */
export function encodePk(
  record: readonly ChangesetCell[],
  primaryKey: readonly boolean[],
): Uint8Array {
  const out: number[] = [];
  primaryKey.forEach((pk, i) => {
    if (!pk) return;
    const value = record[i];
    if (value === undefined) throw new Error("primary key value is missing");
    if (value === null) out.push(5);
    else if (typeof value === "bigint") {
      let x = BigInt.asUintN(64, value);
      const bytes: number[] = [];
      for (let k = 0; k < 8; k++) {
        bytes.unshift(Number(x % BYTE));
        x /= BYTE;
      }
      out.push(1, ...bytes);
    } else if (typeof value === "number") {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, value, false);
      out.push(2);
      for (let k = 0; k < 8; k++) out.push(view.getUint8(k));
    } else if (typeof value === "string") {
      const bytes = utf8Encode(value);
      out.push(3, ...varint(bytes.length), ...bytes);
    } else {
      out.push(4, ...varint(value.length), ...value);
    }
  });
  return new Uint8Array(out);
}
