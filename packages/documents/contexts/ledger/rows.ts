// context ledger 표의 행 읽기·쓰기다. 표마다 load/save 한 벌이고 값은 contracts의 값 모양
// (ContextValue, BundleSummary, CheckReport, SavedViewValue, GlossaryEntry)을 그대로 쓴다.
// SQL 열과 값 사이의 바꿈(JSON 글, blob 참조 두 열)은 여기서만 한다.
//
// 읽기 함수는 `Pick<Sql, "get" | "all">`만 받아서 command의 tx.sql과 읽기 snapshot이 같이 쓴다.
// 쓰기 함수는 `Sql`을 받는다. 저장된 행이 모양을 어기면 Error를 던진다(STRICT 표와 CHECK가 막지만
// 다른 경로로 들어온 행을 믿지 않는다). platform이 던진 Error를 `internal`로 바꾸고 transaction을
// rollback한다.
//
// 쓰는 순서 규칙(adapter가 지킨다): 같은 transaction에서 판의 상태가 서로 바뀔 때
// (적용 ↔ 물러남) 물러나는 행을 먼저 쓴다. 한 context에 applied는 하나라는 partial unique index가
// 문장마다 검사하기 때문이다. contexts.applied_bundle과 context_bundles."check"는 commit 때 검사한다.
import type {
  BundleSummary,
  CheckReport,
  ContextValue,
  GlossaryEntry,
  SavedViewValue,
} from "../../../contracts/documents/mod.ts";
import type { Sql } from "../../../contracts/platform/mod.ts";
import type { BlobReference } from "../api/state.ts";

type Reader = Pick<Sql, "get" | "all">;

// 판의 행. content는 blob이라 참조만 담는다. 내용은 adapter가 blob reader로 읽는다.
export type StoredBundle = BundleSummary & { content_ref: BlobReference };

export type ProjectRef = { id: string; archived: boolean };

// documents/projects의 projects 표에서 읽는다. 없으면 null이다.
export function loadProject(_sql: Reader, _id: string): ProjectRef | null {
  throw new Error("not implemented");
}

// 판·검사·saved view·용어 항목의 id로 그것이 속한 context를 찾는다. 없으면 null이다.
export function contextOf(
  _sql: Reader,
  _kind: "bundle" | "check" | "view" | "entry",
  _id: string,
): string | null {
  throw new Error("not implemented");
}

// ---------- contexts ----------

export function loadContext(_sql: Reader, _id: string): ContextValue | null {
  throw new Error("not implemented");
}

// project의 context 전부(보관된 것 포함). 제목 유일 검사와 목록이 쓴다. id 순이다.
export function loadProjectContexts(
  _sql: Reader,
  _project: string,
): ContextValue[] {
  throw new Error("not implemented");
}

// 없으면 넣고 있으면 바꾼다(id·project는 바뀌지 않는다).
export function saveContext(_sql: Sql, _value: ContextValue): void {
  throw new Error("not implemented");
}

// ---------- context_bundles ----------

// context의 판 전부(버린 draft 포함). id 순이다.
export function loadContextBundles(
  _sql: Reader,
  _context: string,
): StoredBundle[] {
  throw new Error("not implemented");
}

// project의 모든 context의 판. context.list가 쓴다. id 순이다.
export function loadProjectBundles(
  _sql: Reader,
  _project: string,
): StoredBundle[] {
  throw new Error("not implemented");
}

export function loadBundle(_sql: Reader, _id: string): StoredBundle | null {
  throw new Error("not implemented");
}

export function saveBundle(_sql: Sql, _value: StoredBundle): void {
  throw new Error("not implemented");
}

// ---------- context_checks ----------

// context의 검사 전부. id 순이다.
export function loadContextChecks(
  _sql: Reader,
  _context: string,
): CheckReport[] {
  throw new Error("not implemented");
}

export function loadCheck(_sql: Reader, _id: string): CheckReport | null {
  throw new Error("not implemented");
}

export function saveCheck(_sql: Sql, _value: CheckReport): void {
  throw new Error("not implemented");
}

// ---------- saved_views ----------

// context의 saved view 전부. id 순이다.
export function loadContextViews(
  _sql: Reader,
  _context: string,
): SavedViewValue[] {
  throw new Error("not implemented");
}

export function loadView(_sql: Reader, _id: string): SavedViewValue | null {
  throw new Error("not implemented");
}

export function saveView(_sql: Sql, _value: SavedViewValue): void {
  throw new Error("not implemented");
}

export function deleteView(_sql: Sql, _id: string): void {
  throw new Error("not implemented");
}

// ---------- glossary_entries ----------

// context의 용어 항목 전부. id 순이다(읽기 순서는 읽기 handler가 정한다).
export function loadContextEntries(
  _sql: Reader,
  _context: string,
): GlossaryEntry[] {
  throw new Error("not implemented");
}

export function loadEntry(_sql: Reader, _id: string): GlossaryEntry | null {
  throw new Error("not implemented");
}

export function saveEntry(_sql: Sql, _value: GlossaryEntry): void {
  throw new Error("not implemented");
}

export function deleteEntry(_sql: Sql, _id: string): void {
  throw new Error("not implemented");
}
