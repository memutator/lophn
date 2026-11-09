// RFC 6238(SHA1, 6자리, 30초). seed는 base32 글자나 `otpauth://` URI의 secret이다. 시각은 부르는 쪽이 준다.
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function seedBytes(seed: string): Buffer | undefined {
  let text = seed.trim();
  if (text.startsWith("otpauth://")) {
    if (!URL.canParse(text)) return undefined;
    text = new URL(text).searchParams.get("secret") ?? "";
  }
  text = text.replace(/[\s=-]/g, "").toUpperCase();
  if (text.length === 0) return undefined;
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const char of text) {
    const index = BASE32.indexOf(char);
    if (index < 0) return undefined;
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

// seed가 올바르지 않으면 undefined다.
export function totpCode(seed: string, nowMs: number): string | undefined {
  const key = seedBytes(seed);
  if (key === undefined || key.length === 0) return undefined;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 1_000_000).toString().padStart(6, "0");
}
