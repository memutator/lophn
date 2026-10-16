import { err, type Result } from "../../base/mod.ts";

// 저장 실패는 플랫폼 실패다. 성공 응답이나 앱 problem으로 바꾸지 않는다.
export function storageFailure(reason: "disk_full" | "ledger_corrupt"): Result<
  never
> {
  return err({
    code: "unavailable",
    message: reason === "disk_full"
      ? "저장 공간이 부족하다"
      : "ledger가 손상되었다",
    details: { reason },
  });
}

// 진단 상세는 redaction을 통과한 내용만 준다. 가공하지 못한 원문·stack은
// 제외하고 이유만 남긴다.
export function safeDetail(input: {
  message: string | null;
  redacted: boolean;
}): { message: string | null; omitted: boolean; reason: string | null } {
  if (input.redacted && input.message !== null) {
    return { message: input.message, omitted: false, reason: null };
  }
  return {
    message: null,
    omitted: true,
    reason: "redaction을 통과하지 못한 원문은 제공하지 않는다",
  };
}
