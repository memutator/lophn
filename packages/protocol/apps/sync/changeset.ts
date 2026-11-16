import {
  type ChangesetCell,
  type ChangesetValue,
  utf8Decode,
} from "../../../base/changeset-invert.ts";

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
    encodeValue(value, out);
  });
  return new Uint8Array(out);
}

// changeset의 값 하나의 부호. 큰 blob도 있어 spread로 넣지 않는다.
function encodeValue(value: ChangesetValue, out: number[]): void {
  const append = (bytes: ArrayLike<number>) => {
    for (let k = 0; k < bytes.length; k++) out.push(bytes[k]!);
  };
  if (value === null) out.push(5);
  else if (typeof value === "bigint") {
    let x = BigInt.asUintN(64, value);
    const bytes: number[] = [];
    for (let k = 0; k < 8; k++) {
      bytes.unshift(Number(x % BYTE));
      x /= BYTE;
    }
    out.push(1);
    append(bytes);
  } else if (typeof value === "number") {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, false);
    out.push(2);
    for (let k = 0; k < 8; k++) out.push(view.getUint8(k));
  } else if (typeof value === "string") {
    const bytes = utf8Encode(value);
    out.push(3);
    append(varint(bytes.length));
    append(bytes);
  } else {
    out.push(4);
    append(varint(value.length));
    append(value);
  }
}

const OP_CODE = { insert: 0x12, update: 0x17, delete: 0x09 } as const;

/**
 * row change 하나만 담은 changeset(SQLite session과 같은 bytes). UPDATE의 old는 PK와 바뀐 칸, new는 바뀐 칸만 싣고 나머지는
 * undefined다.
 */
export function rowChangeset(
  table: string,
  // 칸마다 PK 안의 순번(1부터, `pragma table_info`의 pk). PK가 아니면 0.
  primaryKey: readonly number[],
  change: {
    op: "insert" | "update" | "delete";
    old: readonly ChangesetCell[] | null;
    new: readonly ChangesetCell[] | null;
  },
): Uint8Array {
  const out: number[] = [0x54];
  for (const b of varint(primaryKey.length)) out.push(b);
  for (const pk of primaryKey) out.push(pk);
  for (const b of utf8Encode(table)) out.push(b);
  out.push(0, OP_CODE[change.op], 0);
  for (const values of [change.old, change.new]) {
    for (const value of values ?? []) {
      if (value === undefined) out.push(0);
      else encodeValue(value, out);
    }
  }
  return new Uint8Array(out);
}

/**
 * row 하나의 INSERT 하나만 담은 changeset. 적용하지 않고 돌려주는 row를 다른 변경과 같은 꼴(clock과 changeset)로 쥐게 한다.
 */
export function insertChangeset(
  table: string,
  primaryKey: readonly number[],
  values: readonly ChangesetValue[],
): Uint8Array {
  return rowChangeset(table, primaryKey, {
    op: "insert",
    old: null,
    new: values,
  });
}

/**
 * `encodePk`의 반대: PK 칸 값들을 칸 순서대로 돌려준다(PK가 아닌 칸은 없다).
 */
export function decodePk(blob: Uint8Array): ChangesetValue[] {
  const out: ChangesetValue[] = [];
  let pos = 0;
  const length = (): number => {
    let n = 0;
    for (;;) {
      const b = blob[pos++]!;
      n = n * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return n;
    }
  };
  while (pos < blob.length) {
    const type = blob[pos++];
    if (type === 5) out.push(null);
    else if (type === 1) {
      let x = BigInt(0);
      for (let k = 0; k < 8; k++) x = x * BYTE + BigInt(blob[pos++]!);
      out.push(BigInt.asIntN(64, x));
    } else if (type === 2) {
      out.push(
        new DataView(blob.buffer, blob.byteOffset + pos, 8).getFloat64(
          0,
          false,
        ),
      );
      pos += 8;
    } else if (type === 3 || type === 4) {
      const n = length();
      const body = blob.slice(pos, pos + n);
      pos += n;
      out.push(type === 3 ? utf8Decode(body) : body);
    } else {
      throw new Error("primary key blob is malformed");
    }
  }
  return out;
}
