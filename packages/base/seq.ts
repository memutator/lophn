import { err, ok, type Result } from "./result.ts";

// SQLite signed 64-bit. API에서는 정밀도 손실 없는 십진 문자열로만 오간다.
const MAX_SEQ = (1n << 63n) - 1n;
const SEQ = /^(0|[1-9][0-9]*)$/;

export function parseSeq(s: string): Result<bigint> {
  if (!SEQ.test(s)) {
    return err({ code: "invalid_input", message: "invalid seq" });
  }
  const n = BigInt(s);
  if (n > MAX_SEQ) {
    return err({ code: "invalid_input", message: "invalid seq" });
  }
  return ok(n);
}

export function formatSeq(n: bigint): string {
  if (n < 0n || n > MAX_SEQ) {
    throw new Error("seq is outside 0..2^63-1");
  }
  return n.toString(10);
}

// 처리 위치 P 다음 시작 위치.
