// search 읽기 handler의 공용 타입. route 선언은 contract가 하고, 여기서는
// ledger snapshot과 derived read의 표면만 둔다. context filter는 ContextItemSource가
// 주는 contract context items 목록으로 좁힌다. 없는 context나 읽을 수 없는
// context는 fail-closed로 후보를 전부 비운다(documents/contexts, R12).
import type { Result } from "../../base/mod.ts";

export type SearchSnapshotSql = {
  get(
    query: string,
    params: readonly unknown[],
  ): Record<string, unknown> | undefined;
  all(query: string, params: readonly unknown[]): Record<string, unknown>[];
};

export type SearchSnapshot = {
  // ledger read snapshot. 문서·판 metadata는 같은 seq의 일관된 snapshot이다.
  as_of_seq: string;
  sql: SearchSnapshotSql;
};

export type SearchFilters = {
  place?: { kind: "project" | "app"; id: string };
  context?: string;
  formats?: string[];
};

export type PortLookup = {
  port<T>(key: unknown): T;
};

// context filter의 근원. documents/contexts read contract(loadContext)가 주는
// items 목록을 주입해 받는다. 없는 context는 빈 목록이다(존재를 새지 않는다).
export type ContextItemSource = {
  // target 중 document 종류만 후보 좁힘에 쓴다.
  items(contextId: string): Result<readonly ContextItemTarget[]>;
};

export type ContextItemTarget = {
  kind: "document" | "app_command";
  document?: string;
  app?: string;
};

// context 목차의 근원. documents/contexts의 읽기(createContextOutlineSource)가 주는
// 구성과 항목 대상의 현재 ledger 상태를 주입해 받는다. 없는 context는 null이다.
// 항목은 position 순이고 문서 항목의 version은 읽은 시점 최신 판의 고정 id다
// (항목에는 판이 저장되지 않는다: documents/contexts#R4).
export type ContextOutlineItem = {
  target:
    | { kind: "document"; document: string; section: string | null }
    | { kind: "app_command"; app: string; command: string };
  perspective: "basis" | "reference" | "watch";
  reason: string;
  // 문서 항목만. 문서 행이 없으면 undefined다.
  document?: {
    title: string;
    status: "active" | "archived";
    place: { kind: "project" | "app"; id: string } | null;
    version: string | null;
  };
};

export type ContextOutlineRecord = {
  id: string;
  title: string;
  purpose: string;
  revision: string;
  status: "active" | "archived";
  items: readonly ContextOutlineItem[];
};

export type ContextOutlineSource = {
  active(): Result<readonly ContextOutlineRecord[]>;
  get(contextId: string): Result<ContextOutlineRecord | null>;
};

// context 목차의 glossary 근원. documents/terms의 읽기(createTermGlossarySource)가 주는
// 활성 정의와 후보를 주입해 받는다. 이름 순으로 처음 limit개씩이고 근거에는 문서
// 위치를 붙여 목차가 권한 밖 문서의 근거를 뺀다. 근원이 없으면 목차는 용어를 싣지 않는다.
export type TermGlossaryEvidence = {
  document: string;
  version: string;
  section: string | null;
  start_line: number | null;
  end_line: number | null;
  place: { kind: "project" | "app"; id: string } | null;
};

export type TermGlossaryItem = {
  id: string;
  context: string;
  name: string;
  definition: string | null;
  revision: string;
  status: "active" | "archived";
  evidence: readonly TermGlossaryEvidence[];
};

export type TermGlossarySource = {
  get(
    contextId: string,
    limit: number,
  ): Result<{
    definitions: readonly TermGlossaryItem[];
    candidates: readonly TermGlossaryItem[];
  }>;
};
