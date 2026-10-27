import { err, ok, type Result } from "./result.ts";

// SQLite changeset format(sqlite.org/sessionintro.html)을 직접 읽어 뒤집는다.
// node:sqlite에는 sqlite3changeset_invert가 없다. 순수 함수이고 IO가 없다.
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
    return this.bytes[this.pos++];
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
  const reader = new Reader(bytes);
  const out: Uint8Array[] = [];
  while (!reader.done) {
    const headerStart = reader.pos;
    const tag = reader.byte();
    if (tag === TABLE_PATCHSET) {
      throw new Malformed("a patchset has no old values to invert");
    }
    if (tag !== TABLE_CHANGESET) {
      throw new Malformed("unknown changeset section");
    }
    const columns = reader.varint();
    if (columns === 0) throw new Malformed("table without columns");
    const primary: boolean[] = [];
    for (let i = 0; i < columns; i++) primary.push(reader.byte() !== 0);
    while (reader.byte() !== 0); // 표 이름
    out.push(bytes.subarray(headerStart, reader.pos));

    while (
      !reader.done &&
      bytes[reader.pos] !== TABLE_CHANGESET &&
      bytes[reader.pos] !== TABLE_PATCHSET
    ) {
      const op = reader.byte();
      const indirect = reader.byte();
      if (op === OP_INSERT || op === OP_DELETE) {
        out.push(
          new Uint8Array([op === OP_INSERT ? OP_DELETE : OP_INSERT, indirect]),
          ...reader.values(columns),
        );
      } else if (op === OP_UPDATE) {
        const before = reader.values(columns);
        const after = reader.values(columns);
        // sqlite3changeset_invert와 같다: 새 옛값은 PK는 옛 값, 나머지는 새 값. 새 새값은 PK는 undefined, 나머지는 옛 값.
        out.push(new Uint8Array([OP_UPDATE, indirect]));
        for (let i = 0; i < columns; i++) {
          out.push(primary[i] ? before[i] : after[i]);
        }
        for (let i = 0; i < columns; i++) {
          out.push(primary[i] ? UNDEFINED : before[i]);
        }
      } else {
        throw new Malformed("unknown operation in changeset");
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
 * 오래된 것부터 담은 changeset을 최신부터 뒤집어 적용 순서대로 돌려준다.
 */
export function invertAll(changesets: Uint8Array[]): Result<Uint8Array[]> {
  const inverted: Uint8Array[] = [];
  for (let i = changesets.length - 1; i >= 0; i--) {
    const one = invertChangeset(changesets[i]);
    if (!one.ok) return one;
    inverted.push(one.value);
  }
  return ok(inverted);
}
