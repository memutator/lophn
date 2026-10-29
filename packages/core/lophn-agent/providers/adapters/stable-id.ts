import { createHash } from "node:crypto";

// 구독 client profile이 요청에 싣는 conversation·설치 식별값이다. 같은 입력이면 늘 같은 값이라 저장하지 않는다.

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// UUID v4 꼴이다.
export function stableUuid(domain: string, value: string): string {
  const hex = sha256Text(`${domain}\n${value}`).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "89ab"[Number.parseInt(hex[16]!, 16) & 3]!;
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

// 음수 signed 64-bit 정수의 10진 글이다. JS number로 옮기면 자릿수를 잃어 글로만 다룬다.
export function stableNegativeDecimal(domain: string, value: string): string {
  const hex = sha256Text(`${domain}\n${value}`).slice(0, 16);
  const magnitude = BigInt(`0x${hex}`) & 0x7fffffffffffffffn || 1n;
  return `-${magnitude.toString(10)}`;
}
