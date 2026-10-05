// `/v1/files/status` read(file-tracking#R9). FileStatus는 ledger 열이 아니다.
// 조회 때 coordinator가 쥔 마지막 관측으로 계산한다. 관측이 없으면 추적 안 함이다.
import { ok } from "../../base/mod.ts";
import type { FileTarget } from "../../contracts/documents/mod.ts";
import { filesStatus } from "../../contracts/documents/mod.ts";
import type {
  ApiReadDefinition,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import { fileStatusOf, type StatusInput } from "./observation.ts";

// coordinator 메모리의 마지막 관측. 없는 경로는 추적 밖이다.
export type StatusObservation = StatusInput & {
  observedAt: string;
  comparedVersion: string | null;
  projectRevision: string | null;
  details: string | null;
};

export type StatusMemory = {
  lookup(target: FileTarget): StatusObservation | undefined;
};

const UNTRACKED_AT = "1970-01-01T00:00:00.000Z";

export function fileStatusRead(
  memory: StatusMemory,
): ApiReadDefinition<typeof filesStatus> {
  return {
    route: filesStatus,
    handle(ctx: RequestContext, input) {
      const found = memory.lookup(input.target);
      if (found === undefined) {
        return ok({
          status: {
            state: "not_tracked",
            target: input.target,
            observed_at: UNTRACKED_AT,
            observed_hash: null,
            compared_version: null,
            project_revision: null,
            details: null,
          },
          as_of_seq: "0",
          next_cursor: null,
        });
      }
      void ctx;
      return ok({
        status: {
          state: fileStatusOf(found),
          target: input.target,
          observed_at: found.observedAt,
          observed_hash: found.observedHash,
          compared_version: found.comparedVersion,
          project_revision: found.projectRevision,
          details: found.details,
        },
        as_of_seq: "0",
        next_cursor: null,
      });
    },
  };
}
