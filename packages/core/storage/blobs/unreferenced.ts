// 미참조 확인 기록의 순수 규칙. IO 없음.
// 7일 유예기간은 파일 mtime이 아니라 "미참조를 처음 확인한 시각"부터
// 센다(미참조 확인 시각은 worker 관리 파일에
// 안전하게 남긴다). 관측이 hash를 미참조로 본 때 관측자가 기록을 남기고,
// 다시 참조되면 기록을 지운다(유예기간이 새로 섞인다). 유예기간 판정은 이
// 기록만 본다: 기록이 없는 hash는 "지금부터 미참조"라 지우지 않는다(fail-closed).

import { err, ok, type Result } from "../../../base/mod.ts";

// 미참조 확인 기록 하나의 모양. 처음 확인한 시각만 남긴다.
type UnreferencedRecord = {
  // 미참조를 처음 확인한 시각(ms).
  unreferencedAtMs: number;
};

// 미참조 기록 폴더. 구분력은 hash 앞 2자 폴더가 정하고 이름은 나머지 62자다.
const UNREFERENCED_DIR = "blobs/unreferenced";
const UNREFERENCED_PREFIX_CHARS = 2;

// sha256 64-hex. 경로 구분력은 이 모양만 받는다(다른 모양은 경로로 만들지 않는다).
const SHA256_HEX = /^[0-9a-f]{64}$/;

// 관측한 hash가 sha256 64-hex인지. 다른 모양은 경로 함수가 거절한다.
export function isSha256Hash(hash: string): boolean {
  return SHA256_HEX.test(hash);
}

// hash의 미참조 기록 경로. sha256 64-hex 밖은 거절한다(invalid_input).
export function unreferencedPathFor(
  root: string,
  hash: string,
): Result<string> {
  if (!SHA256_HEX.test(hash)) {
    return err({
      code: "invalid_input",
      message: "blob hash가 sha256 64-hex가 아니다",
    });
  }
  return ok(
    `${root}/${UNREFERENCED_DIR}/${hash.slice(0, UNREFERENCED_PREFIX_CHARS)}/${
      hash.slice(UNREFERENCED_PREFIX_CHARS)
    }.json`,
  );
}

// 미참조 기록 JSON을 검사한다. 모양이 다르면 undefined다(fail-closed).
export function parseUnreferencedRecord(
  raw: unknown,
): UnreferencedRecord | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const at = (raw as Record<string, unknown>)["unreferenced_at_ms"];
  if (
    typeof at !== "number" || !Number.isFinite(at) || at < 0 ||
    Number.isInteger(at) === false
  ) {
    return undefined;
  }
  return { unreferencedAtMs: at };
}

// 유예기간 판정. 기록의 처음 확인 시각만 본다.
export function unreferencedGracePassed(
  record: UnreferencedRecord | undefined,
  nowMs: number,
  graceMs: number,
): boolean {
  if (record === undefined) return false;
  return nowMs - record.unreferencedAtMs >= graceMs;
}
