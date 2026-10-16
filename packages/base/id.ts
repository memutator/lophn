import type { Clock } from "./clock.ts";
import type { RandomSource } from "./random.ts";

// Crockford base32. ULID의 시각 48bit·random 80bit를 소문자로 적는다.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

const PREFIX = /^[a-z]{3}$/;

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const BYTE_BITS = 8n;

export type IdSource = {
  newId(prefix: string): string;
};

function encode(value: bigint, length: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[Number(rest & 31n)] + out;
    rest >>= 5n;
  }
  return out;
}

function readRandom(random: RandomSource): bigint {
  const bytes = new Uint8Array(10);
  random.fill(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << BYTE_BITS) + BigInt(byte);
  return value;
}

function increment(random: bigint): bigint {
  const next = random + 1n;
  if (next >> (5n * BigInt(RANDOM_CHARS)) !== 0n) {
    throw new Error(
      "ULID random part overflowed within the same millisecond",
    );
  }
  return next;
}

export function createIdSource(deps: {
  clock: Clock;
  random: RandomSource;
}): IdSource {
  let lastMs = -1;
  let lastRandom = 0n;
  return {
    newId(prefix: string): string {
      if (!PREFIX.test(prefix)) {
        throw new Error("ID prefix must be three lowercase ASCII letters");
      }
      const ms = deps.clock.nowMs();
      // 시계가 같은 밀리초로 돌아오면 앞서 낸 random을 다시 쓰면 안 된다.
      const random = ms > lastMs
        ? readRandom(deps.random)
        : increment(lastRandom);
      lastMs = ms;
      lastRandom = random;
      const ulid = encode(BigInt(ms), TIME_CHARS) +
        encode(random, RANDOM_CHARS);
      return `${prefix}_${ulid}`;
    },
  };
}

