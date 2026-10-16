import { err, fingerprint, ok, type Result } from "../../../base/mod.ts";

// domain-model platform/ledger: 지문은 command, 정규화 input, compare, turn,
// prepared의 불변 참조와 사람 결정의 대상·내용을 포함한다.
// token·전송 시도 ID·일회 handle 원문은 제외한다.
export type FingerprintInput = {
  command: string;
  input: unknown;
  compare: unknown;
  turn: string | null;
  prepared: readonly string[];
  decision: { target: unknown; content: unknown } | null;
};

function fingerprintBody(parts: FingerprintInput): unknown {
  return {
    command: parts.command,
    input: parts.input,
    compare: parts.compare,
    turn: parts.turn,
    prepared: [...parts.prepared],
    decision: parts.decision,
  };
}

export function commandFingerprint(parts: FingerprintInput): Promise<string> {
  return fingerprint(fingerprintBody(parts));
}

// 같은 입력이면 RFC 8785 직렬화가 같다.

// CAS 256개 초과는 handler 전에 거절한다. 변경 행 한도는 tx가 실제 changes로 본다.
const COMMAND_MAX_CAS = 256;

// 받은 비교 대상의 leaf 수다. 실제 비교 횟수가 아니다. 중첩 키와 배열 원소를 센다.
export function countCas(compare: unknown): number {
  if (Array.isArray(compare)) {
    return compare.reduce((sum, item) => sum + countCas(item), 0);
  }
  if (compare !== null && typeof compare === "object") {
    return Object.values(compare).reduce<number>(
      (sum, item) => sum + countCas(item),
      0,
    );
  }
  return 1;
}

export function withinCommandLimits(casCount: number): Result<void> {
  if (casCount > COMMAND_MAX_CAS) {
    return err({
      code: "invalid_input",
      message: "CAS 대상이 한도를 넘는다",
    });
  }
  return ok(undefined);
}
