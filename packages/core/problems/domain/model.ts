import type { Violation } from "../../../protocol/projects/mod.ts";

export type ExistingDomainProblem = {
  id: string;
  identity: string;
  state: "open" | "resolved";
  message: string;
};

export type IncomingViolation = { id: string; violation: Violation };

// NUL로 잇지 않는다: node:sqlite가 text를 읽을 때 첫 NUL에서 잘라 저장된 identity가 다시 맞지 않는다.
export function violationIdentity(v: Violation): string {
  return JSON.stringify([v.source, v.kind, v.path, v.field, v.rule]);
}

// 이번에 알린 위반 전체와 저장된 행을 견주어 무엇을 쓸지 정한다. `truncated`이면 목록이 일부라
// 안 보이는 열린 위반이 사라진 것인지 모르므로 닫지 않는다. unchanged는 상태가 바뀌지 않는 기존 행 수다.
export function diffDomainProblems(
  { existing, incoming, truncated }: {
    existing: readonly ExistingDomainProblem[];
    incoming: readonly IncomingViolation[];
    truncated: boolean;
  },
) {
  const byIdentity = new Map(existing.map((row) => [row.identity, row]));
  const seen = new Map<string, IncomingViolation>();
  for (const item of incoming) {
    const identity = violationIdentity(item.violation);
    if (!seen.has(identity)) seen.set(identity, item);
  }
  const insert: (IncomingViolation & { identity: string })[] = [];
  const reopen: { id: string; message: string }[] = [];
  const touch: { id: string; message: string }[] = [];
  const resolve: { id: string }[] = [];
  for (const [identity, item] of seen) {
    const row = byIdentity.get(identity);
    if (row === undefined) insert.push({ ...item, identity });
    else if (row.state === "resolved") {
      reopen.push({ id: row.id, message: item.violation.message });
    } else touch.push({ id: row.id, message: item.violation.message });
  }
  if (!truncated) {
    for (const row of existing) {
      if (row.state === "open" && !seen.has(row.identity)) {
        resolve.push({ id: row.id });
      }
    }
  }
  return {
    insert,
    reopen,
    resolve,
    touch,
    unchanged: existing.length - reopen.length - resolve.length,
  };
}
