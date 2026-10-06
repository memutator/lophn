// search 후보 집합. 권한 밖 ID는 후보 단계에서 빠지고, 보관 문서는 현재 ledger
// 상태로 빠진다(R17). 없는 대상과 같은 응답을 위해 존재를 새지 않는다.
// context filter는 ContextItemSource의 items 목록으로 좁힌다. 없는 context나
// 읽을 수 없는 context는 fail-closed로 후보를 전부 비운다(R12).
import { TargetAuthorization } from "../../contracts/platform/mod.ts";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import type {
  ContextItemSource,
  PortLookup,
  SearchFilters,
  SearchSnapshot,
} from "./types.ts";

export function candidateDocuments(
  snapshot: SearchSnapshot,
  ctx: RequestContext,
  ports: PortLookup,
  filters: SearchFilters,
  documents?: string[],
  contexts?: ContextItemSource,
): Set<string> {
  // context filter. 목록을 받지 못하면 fail-closed로 전부 비운다. items 목록의
  // document 종류 target만 후보 좁힘에 쓴다.
  const contextDocuments = contextDocumentSet(contexts, filters.context);
  if (contextDocuments !== undefined && contextDocuments.size === 0) {
    return new Set();
  }
  const allowed = new Set<string>();
  const scan = (id: string): void => {
    if (contextDocuments !== undefined && !contextDocuments.has(id)) return;
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

// context filter의 document 목록. context가 없으면 undefined(filter 없음),
// 있으면 document 종류 target의 document 집합이다. 목록을 받지 못했으면
// fail-closed로 빈 집합을 준다.
function contextDocumentSet(
  contexts: ContextItemSource | undefined,
  contextId: string | undefined,
): Set<string> | undefined {
  if (contextId === undefined) return undefined;
  if (contexts === undefined) return new Set();
  const loaded = contexts.items(contextId);
  if (!loaded.ok) return new Set();
  const documents = new Set<string>();
  for (const item of loaded.value) {
    if (item.kind === "document" && item.document !== undefined) {
      documents.add(item.document);
    }
  }
  return documents;
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
