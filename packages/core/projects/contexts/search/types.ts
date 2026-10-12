// 선언 검색 실행기의 입력·출력. 규칙은 docs/domain-model/documents/contexts.md "실행 규칙"이다.
import type { BundleContent } from "../../../../protocol/projects/mod.ts";

// 추출 결과의 개체와 같은 모양이다(extract/를 import하지 않으려고 따로 적는다).
export type SearchEntity = {
  type: string;
  key: string;
  path: string;
  section: string | null;
  fields: Readonly<Record<string, unknown>>;
  links: readonly { relation: string; target_key: string }[];
};

export type EntityRef = {
  type: string;
  key: string;
  path: string;
  section: string | null;
};

// 시작 개체와 follow 별칭에 붙은 개체. 별칭 개체마다 추출 순서(entities 배열의 위치)를 같이 둔다.
export type Row = {
  base: SearchEntity;
  base_index: number;
  aliases: Readonly<Record<string, { entity: SearchEntity; index: number }>>;
};

// 이름 → 값. 주지 않은 선택 입력은 없다.
export type InputValues = Readonly<Record<string, unknown>>;

export type SearchErrorCode =
  | "search_unknown"
  | "input_invalid"
  | "input_required"
  | "cursor_mismatch";
export type SearchError = { code: SearchErrorCode; input?: string };

export type Cell = { path: string; value: unknown; ref: EntityRef | null };
export type ResultRow = { ref: EntityRef; cells: Cell[]; group?: unknown };

export type TablePage = {
  kind: "table";
  rows: ResultRow[];
  total: number;
  next_cursor: string | null;
};
export type BoardLane = { value: unknown; rows: ResultRow[]; more: number };
export type BoardResult = { kind: "board"; lanes: BoardLane[]; total: number };

export type SearchResult =
  | { ok: true; result: TablePage | BoardResult }
  | { ok: false; error: SearchError };

export type RunSearchArgs = {
  bundle: BundleContent;
  search: string;
  inputs: InputValues;
  entities: readonly SearchEntity[];
  cursor?: string | null;
};
