// search 후보 집합. 권한 밖 ID는 후보 단계에서 빠지고, 보관 문서는 현재 ledger
// 상태로 빠진다(R17). 없는 대상과 같은 응답을 위해 존재를 새지 않는다.
import { TargetAuthorization } from "../../protocol/platform/mod.ts";
import type { RequestContext } from "../../protocol/platform/mod.ts";
import type { PortLookup, SearchFilters, SearchSnapshot } from "./types.ts";

export function candidateDocuments(
  snapshot: SearchSnapshot,
  ctx: RequestContext,
  ports: PortLookup,
  filters: SearchFilters,
  documents?: string[],
): Set<string> {
  const allowed = new Set<string>();
  const scan = (id: string): void => {
    const row = snapshot.sql.get(
      `SELECT id, place_kind, place_id, status FROM documents WHERE id = ?`,
      [id],
    );
    if (row === undefined) return;
    if (String(row["status"]) !== "active") return;
    const place = placeOf(row);
    if (filters.place !== undefined) {
      if (
        place === null || place.kind !== filters.place.kind ||
        place.id !== filters.place.id
      ) return;
    }
    // 권한 밖 ID는 후보 단계에서 빠진다. 없는 대상과 같다(존재를 새지 않는다).
    if (!allowCandidate(ports, ctx, id, place)) return;
    allowed.add(id);
  };
  if (documents !== undefined) {
    for (const id of documents) scan(id);
  } else {
    for (
      const row of snapshot.sql.all(
        `SELECT id FROM documents WHERE status = 'active'`,
        [],
      )
    ) {
      scan(String(row["id"]));
    }
  }
  return allowed;
}

function placeOf(
  row: Record<string, unknown>,
): { kind: string; id: string } | null {
  const kind = row["place_kind"];
  const id = row["place_id"];
  if (typeof kind === "string" && typeof id === "string") return { kind, id };
  return null;
}

export function allowCandidate(
  ports: PortLookup,
  ctx: RequestContext,
  id: string,
  place: { kind: string; id: string } | null,
): boolean {
  let authorize: unknown;
  try {
    authorize = ports.port(TargetAuthorization);
  } catch {
    return false;
  }
  if (typeof authorize !== "function") return false;
  try {
    const result = authorize(ctx, "search.query", {
      document: id,
      place_kind: place === null ? undefined : place.kind,
      place: place === null ? undefined : place.id,
      ...(place !== null && place.kind === "app" ? { app: place.id } : {}),
    });
    if (result instanceof Promise) {
      void result.catch(() => {});
      return false;
    }
    if (typeof result !== "object" || result === null || "then" in result) {
      return false;
    }
    return result.ok === true;
  } catch {
    return false;
  }
}
