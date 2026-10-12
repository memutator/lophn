import { ok, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  DiagnosticRecord,
} from "../../protocol/platform/mod.ts";
import { diagnosticsList } from "../../protocol/platform/mod.ts";
import type { ReadHandler } from "../server/mod.ts";

export type DiagnosticQuery = {
  component?: string;
  kind?: DiagnosticRecord["kind"];
};

// 기록된 안전 진단. 원문은 여기 들어오기 전에 redaction을 통과한 것이다
// (platform/diagnostics#R5).
export type DiagnosticListSource = {
  records(query: DiagnosticQuery): readonly DiagnosticRecord[];
};

export function diagnosticsListRead(source: DiagnosticListSource): ReadHandler {
  return (
    _ctx: AuthenticatedContext,
    input: unknown,
  ): Result<unknown> => {
    const query = input && typeof input === "object"
      ? input as DiagnosticQuery
      : {};
    return ok({
      records: source.records({
        component: query.component,
        kind: query.kind,
      }),
      as_of_seq: "0",
      next_cursor: null,
    });
  };
}

export const DIAGNOSTICS_LIST_ROUTE = diagnosticsList;
