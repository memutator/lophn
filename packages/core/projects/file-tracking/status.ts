// `/v1/files/status` read. FileStatus는 ledger 열이 아니다.
// 조회 때 coordinator가 쥔 마지막 관측으로 계산한다. 관측이 없으면 추적 안 함이다.
import { ok, type Result } from "../../../base/mod.ts";
import type { FileStatus, FileTarget } from "../../../protocol/projects/mod.ts";
import { filesStatus } from "../../../protocol/projects/mod.ts";
import type {
  ApiReadDefinition,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { fileStatusOf, type StatusInput } from "./observation.ts";

// coordinator 메모리의 마지막 관측. 없는 경로는 추적 밖이다.
export type StatusObservation = StatusInput & {
  observedAt: string;
  comparedVersion: string | null;
  projectRevision: string | null;
  details: string | null;
};

// 조회는 coordinator 메모리를 묻는다. coordinator가 없거나 답하지 않으면 err다:
// 추적 안 함으로 꾸미지 않는다.
export type StatusMemory = {
  lookup(
    target: FileTarget,
  ):
    | Result<StatusObservation | undefined>
    | Promise<Result<StatusObservation | undefined>>;
};

// coordinator 프로세스가 쥔 마지막 관측. 같은 대상의 새 관측이 옛것을 대체한다.
export type StatusRecorder = {
  report(target: FileTarget, observation: StatusObservation): void;
  get(target: FileTarget): StatusObservation | undefined;
};

// 대상의 정규 key. 필드 순서와 무관하다.
export function statusKey(target: FileTarget): string {
  const entries = Object.entries(target).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return JSON.stringify(entries);
}

export function createStatusRecorder(): StatusRecorder {
  const memory = new Map<string, StatusObservation>();
  return {
    report(target, observation) {
      memory.set(statusKey(target), observation);
    },
    get: (target) => memory.get(statusKey(target)),
  };
}

const UNTRACKED_AT = "1970-01-01T00:00:00.000Z";

// 조회 결과의 FileStatus. 관측이 없는 대상은 추적 밖이다. 같은 계산을 `/v1/files/status`와
// `/v1/files/watch`가 쓴다.
export function fileStatusView(
  target: FileTarget,
  found: StatusObservation | undefined,
): FileStatus {
  if (found === undefined) {
    return {
      state: "not_tracked",
      target,
      observed_at: UNTRACKED_AT,
      observed_hash: null,
      compared_version: null,
      project_revision: null,
      details: null,
    };
  }
  return {
    state: fileStatusOf(found),
    target,
    observed_at: found.observedAt,
    observed_hash: found.observedHash,
    compared_version: found.comparedVersion,
    project_revision: found.projectRevision,
    details: found.details,
  };
}

export function fileStatusRead(
  memory: StatusMemory,
): ApiReadDefinition<typeof filesStatus> {
  return {
    route: filesStatus,
    async handle(_ctx: RequestContext, input) {
      const looked = await memory.lookup(input.target);
      if (!looked.ok) return looked;
      return ok({
        status: fileStatusView(input.target, looked.value),
        as_of_seq: "0",
        next_cursor: null,
      });
    },
  };
}
