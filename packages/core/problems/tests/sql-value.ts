import { err, ok, type Result } from "../../../base/mod.ts";
import { parseSeq } from "../../../base/mod.ts";

const INVALID = "테스트 요청이 올바르지 않다";

// setReadBigInts(true)는 1을 1n으로 준다. number 1과 bigint 1을 같이 본다.
export function flag(value: unknown): boolean {
  return value === 1 || value === 1n || value === true;
}

function int64(value: unknown): Result<bigint> {
  if (typeof value === "bigint") {
    if (value < 0n) return err({ code: "internal", message: INVALID });
    return ok(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return ok(BigInt(value));
  }
  if (typeof value === "string") return parseSeq(value);
  return err({ code: "internal", message: INVALID });
}

export function nextSeq(value: unknown): Result<bigint> {
  const parsed = int64(value);
  if (!parsed.ok) return parsed;
  return ok(parsed.value);
}
