// XXH64 hash다(xxHash 64-bit). Claude Code client profile의 cch 계산에만 쓴다. 의존성을 늘리지 않으려고 BigInt로
// 옮겨 적었다. 결과는 unsigned 64-bit 값이다.

const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;
const MASK = 0xffffffffffffffffn;

function rotl(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK;
}

function round(acc: bigint, lane: bigint): bigint {
  return (rotl((acc + lane * P2) & MASK, 31n) * P1) & MASK;
}

function merge(acc: bigint, lane: bigint): bigint {
  return ((((acc ^ round(0n, lane)) * P1) & MASK) + P4) & MASK;
}

export function xxh64(data: Uint8Array, seed: bigint): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = data.byteLength;
  let at = 0;
  let hash: bigint;
  if (length >= 32) {
    let v1 = (seed + P1 + P2) & MASK;
    let v2 = (seed + P2) & MASK;
    let v3 = seed & MASK;
    let v4 = (seed - P1) & MASK;
    while (at + 32 <= length) {
      v1 = round(v1, view.getBigUint64(at, true));
      v2 = round(v2, view.getBigUint64(at + 8, true));
      v3 = round(v3, view.getBigUint64(at + 16, true));
      v4 = round(v4, view.getBigUint64(at + 24, true));
      at += 32;
    }
    hash = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & MASK;
    hash = merge(hash, v1);
    hash = merge(hash, v2);
    hash = merge(hash, v3);
    hash = merge(hash, v4);
  } else {
    hash = (seed + P5) & MASK;
  }
  hash = (hash + BigInt(length)) & MASK;
  while (at + 8 <= length) {
    hash ^= round(0n, view.getBigUint64(at, true));
    hash = (rotl(hash, 27n) * P1 + P4) & MASK;
    at += 8;
  }
  if (at + 4 <= length) {
    hash ^= (BigInt(view.getUint32(at, true)) * P1) & MASK;
    hash = (rotl(hash, 23n) * P2 + P3) & MASK;
    at += 4;
  }
  while (at < length) {
    hash ^= (BigInt(data[at]!) * P5) & MASK;
    hash = (rotl(hash, 11n) * P1) & MASK;
    at += 1;
  }
  hash ^= hash >> 33n;
  hash = (hash * P2) & MASK;
  hash ^= hash >> 29n;
  hash = (hash * P3) & MASK;
  hash ^= hash >> 32n;
  return hash;
}
