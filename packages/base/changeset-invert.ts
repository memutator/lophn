import { err, ok, type Result } from "./result.ts";

// SQLite changeset format(sqlite.org/sessionintro.html)을 직접 읽는다. 순수 함수이고 IO가 없다.
// node:sqlite에는 sqlite3changeset_invert가 없어 rewind가 여기서 뒤집고, sync core는 같은 reader로
// change를 값으로 읽는다. Node와 폰(Hermes)에서 같이 돌아서 TextDecoder 같은 global에 기대지 않는다.
const TABLE_CHANGESET = 0x54; // 'T'
const TABLE_PATCHSET = 0x50; // 'P'
const OP_INSERT = 0x12;
const OP_DELETE = 0x09;
const OP_UPDATE = 0x17;
const UNDEFINED = new Uint8Array([0x00]);

class Malformed extends Error {}

class Reader {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  byte(): number {
    if (this.pos >= this.bytes.length) {
      throw new Malformed("truncated changeset");
    }
    return this.bytes[this.pos++]!;
  }

  // SQLite varint: 앞 8바이트는 7비트씩, 아홉째는 8비트를 다 쓴다.
  varint(): number {
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      n = n * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return n;
    }
    return n * 256 + this.byte();
  }

  skip(length: number): void {
    if (
      !Number.isSafeInteger(length) ||
      this.pos + length > this.bytes.length
    ) {
      throw new Malformed("truncated changeset");
    }
    this.pos += length;
  }

  // 값 하나의 바이트 범위를 그대로 돌려준다. 다시 부호화하지 않는다.
  value(): Uint8Array {
    const start = this.pos;
    const type = this.byte();
    if (type === 0x01 || type === 0x02) this.skip(8);
    else if (type === 0x03 || type === 0x04) this.skip(this.varint());
    else if (type !== 0x00 && type !== 0x05) {
      throw new Malformed("unknown value type in changeset");
    }
    return this.bytes.subarray(start, this.pos);
  }

  values(count: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < count; i++) out.push(this.value());
    return out;
  }
}

// 표 하나의 구간. 값은 아직 풀지 않은 바이트 범위다. bytes는 header부터 그 표의 마지막 change까지 그대로다.
type RawSection = {
  bytes: Uint8Array;
  header: Uint8Array;
  name: Uint8Array;
  primary: boolean[];
  changes: {
    op: number;
    indirect: number;
    before: Uint8Array[] | null;
    after: Uint8Array[] | null;
  }[];
};

function sections(bytes: Uint8Array): RawSection[] {
  const reader = new Reader(bytes);
  const out: RawSection[] = [];
  while (!reader.done) {
    const headerStart = reader.pos;
    const tag = reader.byte();
    if (tag === TABLE_PATCHSET) {
      throw new Malformed("a patchset has no old values");
    }
    if (tag !== TABLE_CHANGESET) {
      throw new Malformed("unknown changeset section");
    }
    const columns = reader.varint();
    if (columns === 0) throw new Malformed("table without columns");
    const primary: boolean[] = [];
    for (let i = 0; i < columns; i++) primary.push(reader.byte() !== 0);
    const nameStart = reader.pos;
    while (reader.byte() !== 0);
    const section: RawSection = {
      bytes: bytes.subarray(headerStart, headerStart),
      header: bytes.subarray(headerStart, reader.pos),
      name: bytes.subarray(nameStart, reader.pos - 1),
      primary,
      changes: [],
    };
    out.push(section);

    while (
      !reader.done &&
      bytes[reader.pos] !== TABLE_CHANGESET &&
      bytes[reader.pos] !== TABLE_PATCHSET
    ) {
      const op = reader.byte();
      const indirect = reader.byte();
      if (op === OP_INSERT) {
        section.changes.push({
          op,
          indirect,
          before: null,
          after: reader.values(columns),
        });
      } else if (op === OP_DELETE) {
        section.changes.push({
          op,
          indirect,
          before: reader.values(columns),
          after: null,
        });
      } else if (op === OP_UPDATE) {
        const before = reader.values(columns);
        section.changes.push({
          op,
          indirect,
          before,
          after: reader.values(columns),
        });
      } else {
        throw new Malformed("unknown operation in changeset");
      }
    }
    section.bytes = bytes.subarray(headerStart, reader.pos);
  }
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function invert(bytes: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  for (const section of sections(bytes)) {
    out.push(section.header);
    for (const change of section.changes) {
      if (change.op === OP_INSERT) {
        out.push(
          new Uint8Array([OP_DELETE, change.indirect]),
          ...change.after!,
        );
      } else if (change.op === OP_DELETE) {
        out.push(
          new Uint8Array([OP_INSERT, change.indirect]),
          ...change.before!,
        );
      } else {
        const before = change.before!;
        const after = change.after!;
        // sqlite3changeset_invert와 같다: 새 옛값은 PK는 옛 값, 나머지는 새 값. 새 새값은 PK는 undefined, 나머지는 옛 값.
        out.push(new Uint8Array([OP_UPDATE, change.indirect]));
        section.primary.forEach((pk, i) =>
          out.push(pk ? before[i]! : after[i]!),
        );
        section.primary.forEach((pk, i) =>
          out.push(pk ? UNDEFINED : before[i]!),
        );
      }
    }
  }
  return concat(out);
}

function invertChangeset(bytes: Uint8Array): Result<Uint8Array> {
  try {
    return ok(invert(bytes));
  } catch (thrown) {
    if (thrown instanceof Malformed) {
      return err({ code: "invalid_input", message: thrown.message });
    }
    throw thrown;
  }
}

/**
 * `keep`이 true인 표의 구간만 남긴 changeset. 구간은 bytes 그대로라 남은 표의 변경은 원래 changeset과 같이 적용된다.
 * 남은 것이 없으면 빈 bytes다. 깨진 bytes는 invalid_input이다.
 */
export function filterChangeset(
  bytes: Uint8Array,
  keep: (table: string) => boolean,
): Result<Uint8Array> {
  try {
    return ok(
      concat(
        sections(bytes)
          .filter((section) => keep(utf8Decode(section.name)))
          .map((section) => section.bytes),
      ),
    );
  } catch (thrown) {
    if (thrown instanceof Malformed) {
      return err({ code: "invalid_input", message: thrown.message });
    }
    throw thrown;
  }
}

/**
 * 오래된 것부터 담은 changeset을 최신부터 뒤집어 적용 순서대로 돌려준다.
 */
export function invertAll(changesets: Uint8Array[]): Result<Uint8Array[]> {
  const inverted: Uint8Array[] = [];
  for (let i = changesets.length - 1; i >= 0; i--) {
    const one = invertChangeset(changesets[i]!);
    if (!one.ok) return one;
    inverted.push(one.value);
  }
  return ok(inverted);
}

// SQLite 값. INTEGER는 64-bit 전부를 담으려고 bigint, REAL은 number다.
export type ChangesetValue = null | bigint | number | string | Uint8Array;
// undefined는 그 record에 없는 칸이다(UPDATE는 바뀐 칸과 PK만 싣는다).
export type ChangesetCell = ChangesetValue | undefined;

export type ChangesetChange = {
  table: string;
  // 칸마다 PRIMARY KEY인지. 칸 순서는 표의 칸 순서다.
  primaryKey: boolean[];
  op: "insert" | "delete" | "update";
  // INSERT는 old가 null, DELETE는 new가 null이다.
  old: ChangesetCell[] | null;
  new: ChangesetCell[] | null;
};

const TWO32 = BigInt(4294967296);

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i++]!;
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (bytes[i++]! & 0x3f);
    else if (c < 0xf0) {
      cp = ((c & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6);
      cp |= bytes[i++]! & 0x3f;
    } else {
      cp = ((c & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12);
      cp |= ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

function cell(raw: Uint8Array): ChangesetCell {
  const type = raw[0];
  if (type === 0x00) return undefined;
  if (type === 0x05) return null;
  if (type === 0x01) {
    const hi = (raw[1]! << 24) | (raw[2]! << 16) | (raw[3]! << 8) | raw[4]! | 0;
    const lo =
      ((raw[5]! << 24) | (raw[6]! << 16) | (raw[7]! << 8) | raw[8]!) >>> 0;
    return BigInt(hi) * TWO32 + BigInt(lo);
  }
  if (type === 0x02) {
    return new DataView(raw.buffer, raw.byteOffset + 1, 8).getFloat64(0, false);
  }
  // text와 blob은 varint 길이 뒤에 바이트가 온다.
  const reader = new Reader(raw);
  reader.byte();
  const length = reader.varint();
  const body = raw.slice(reader.pos, reader.pos + length);
  return type === 0x03 ? utf8Decode(body) : body;
}

function read(bytes: Uint8Array): ChangesetChange[] {
  const out: ChangesetChange[] = [];
  for (const section of sections(bytes)) {
    const table = utf8Decode(section.name);
    for (const change of section.changes) {
      out.push({
        table,
        primaryKey: section.primary,
        op:
          change.op === OP_INSERT
            ? "insert"
            : change.op === OP_DELETE
              ? "delete"
              : "update",
        old: change.before && change.before.map(cell),
        new: change.after && change.after.map(cell),
      });
    }
  }
  return out;
}

/**
 * changeset을 row change마다 값으로 읽는다. patchset이나 깨진 바이트는 invalid_input이다.
 */
export function readChangeset(bytes: Uint8Array): Result<ChangesetChange[]> {
  try {
    return ok(read(bytes));
  } catch (thrown) {
    if (thrown instanceof Malformed) {
      return err({ code: "invalid_input", message: thrown.message });
    }
    throw thrown;
  }
}
