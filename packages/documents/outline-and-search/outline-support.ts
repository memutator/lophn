// outline·search 읽기가 같이 쓰는 작은 읽기 도우미. 범위 검사, 선택 판의 format,
// index coverage다. 읽기 handler 모듈들이 서로 import하지 않게 여기 둔다.
import type { SearchResult } from "../../contracts/documents/mod.ts";
import {
  type AuthorizationTarget,
  type RequestContext,
  TargetAuthorization,
} from "../../contracts/platform/mod.ts";
import type { DerivedRead } from "./adapters/store.ts";
import type { PortLookup, SearchSnapshot } from "./types.ts";
import { allOmissions, type SearchCoverage } from "./work.ts";

// coverage는 현재 scope의 진실이다. 같은 seq에도 lagging=true를 허용한다.
// omissions도 허용 집합에서 뺀다. 권한 밖 문서의 누락은 응답에 새지 않는다(R12).
export function coverageOfLike(
  read: DerivedRead,
  ledgerBasisSeq: string,
  allowed?: ReadonlySet<string>,
): SearchCoverage {
  const row = read.sql.get(
    `SELECT processed_seq, rebuilding FROM derived_cursors WHERE consumer = 'search'`,
    [],
  );
  const processed = row === undefined ? "0" : String(row.processed_seq);
  const rebuilding = row === undefined ? false : Number(row.rebuilding) === 1;
  const basis = ledgerBasisSeq;
  const lagging = BigInt(processed) < BigInt(basis);
  return {
    processed_seq: processed,
    ledger_basis_seq: basis,
    lagging,
    rebuilding,
    omissions: allOmissions(read.sql, allowed),
  };
}

export function formatRef(
  snapshot: SearchSnapshot,
  version: string,
): SearchResult["format"] | null {
  const row = snapshot.sql.get(
    `SELECT format_name, module_hash, format_explicit FROM versions WHERE id = ?`,
    [version],
  );
  if (row === undefined) return null;
  const name = row["format_name"];
  const hash = row["module_hash"];
  if (typeof name !== "string" || typeof hash !== "string") return null;
  const explicit = row["format_explicit"];
  return {
    name,
    module_hash: hash,
    explicit: explicit === 1 || explicit === BigInt(1),
  };
}

// 범위 검사. 권한 밖은 없는 대상과 같이 답한다. port가 없거나 판정이 동기 Result가
// 아니면 fail-closed다.
export function authorize(
  ports: PortLookup,
  ctx: RequestContext,
  operation: string,
  target: AuthorizationTarget,
): boolean {
  let authorizer: unknown;
  try {
    authorizer = ports.port(TargetAuthorization);
  } catch {
    return false;
  }
  if (typeof authorizer !== "function") return false;
  try {
    const result = authorizer(ctx, operation, target);
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

// 단일 문서 대상의 범위 검사.
export function authorizeTarget(
  deps: { ports: PortLookup },
  ctx: RequestContext,
  operation: string,
  document: string,
  placeKind: string | undefined,
  placeId: string | undefined,
): boolean {
  return authorize(deps.ports, ctx, operation, {
    document,
    place_kind: placeKind,
    place: placeId,
  } as AuthorizationTarget);
}
