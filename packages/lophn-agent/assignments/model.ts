import type { Assignment } from "../../protocol/lophn-agent/mod.ts";

// row를 화면 값으로 바꾸는 도움. entity와 상태 전이 규칙은 domain-model
// lophn-agent/assignments의 표·상태 그대로다. 순수 함수만 있고 IO는 없다.

export type AssignmentRow = {
  id: string;
  role: string;
  scope_kind: string;
  scope_id: string | null;
  state: string;
  pause_detail: string | null;
  pause_target: string | null;
  revision: number;
};

export const ASSIGNMENT_COLUMNS =
  "id, role, scope_kind, scope_id, state, pause_detail, pause_target, revision";

// ledger는 INTEGER 열을 bigint로 준다(platform/ledger#R9). 화면 값은 number다.
export function rowOf(record: Record<string, unknown>): AssignmentRow {
  const text = (value: unknown) => value === null ? null : String(value);
  return {
    id: String(record["id"]),
    role: String(record["role"]),
    scope_kind: String(record["scope_kind"]),
    scope_id: text(record["scope_id"]),
    state: String(record["state"]),
    pause_detail: text(record["pause_detail"]),
    pause_target: text(record["pause_target"]),
    revision: Number(record["revision"]),
  };
}

function scopeOf(row: AssignmentRow): Assignment["scope"] {
  if (row.scope_kind === "all") return { kind: "all", id: null };
  if (row.scope_kind === "project") {
    return { kind: "project", id: row.scope_id ?? "" } as Assignment["scope"];
  }
  return { kind: "app", id: row.scope_id ?? "" } as Assignment["scope"];
}

export function recordOf(row: AssignmentRow): Assignment {
  const paused = row.state === "paused";
  return {
    id: row.id,
    role: row.role as Assignment["role"],
    scope: scopeOf(row),
    state: row.state as Assignment["state"],
    pause_reason: paused
      ? {
        kind: "scope_archived",
        detail: row.pause_detail ?? "",
        target: (row.pause_target ?? "") as never,
      }
      : null,
    revision: row.revision,
  };
}

// lophn·Context Engineer는 역할마다 전역 하나라 사람이 거둘 수 없다(R9).
export function isBuiltin(role: string): boolean {
  return role === "lophn" || role === "context_engineer";
}
