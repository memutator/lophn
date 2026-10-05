import type { SchemaStep } from "../../contracts/platform/mod.ts";

// GLOB은 문자 클래스 하나마다 패턴 길이를 세므로 긴 패턴은 거절된다(versions 표와 같다).
// 접두사·정확한 길이를 여기서 고정하고 문자 집합은 행을 읽는 쪽에서 schema로 다시 검사한다.
const idCheck = (prefix: string) =>
  `id GLOB '${prefix}_*' AND length(id) = ${prefix.length + 1 + 26}`;
const SEQ =
  "length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'" +
  " AND revision NOT GLOB '*[^0-9]*'" +
  " AND (length(revision) < 19 OR" +
  " (length(revision) = 19 AND revision <= '9223372036854775807'))";

// saved_views 표(domain-model/documents/outline-and-search ledger 표). 조건은
// 정본 JSON으로 둔다. 목록·open 결과는 ledger에 쓰지 않는다. 삭제는 행을 지우며
// 보관이 아니라서 no_delete trigger가 없다. 삭제된 이름은 다시 쓸 수 있다.
export const savedViewsSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.outline-and-search.saved_views",
  sql: `
    CREATE TABLE saved_views (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("viw")}),
      name TEXT NOT NULL CHECK (length(name) > 0 AND length(trim(name)) > 0),
      place_kind TEXT CHECK (place_kind IN ('project', 'app')),
      place_id TEXT,
      filter TEXT NOT NULL CHECK (length(filter) > 0),
      sort TEXT NOT NULL CHECK (sort IN ('updated_desc', 'updated_asc', 'title_asc', 'address_asc')),
      revision TEXT NOT NULL CHECK (${SEQ}),
      CHECK (
        (place_kind IS NULL AND place_id IS NULL) OR
        (place_kind IS NOT NULL AND place_id IS NOT NULL AND length(place_id) > 0)
      )
    ) STRICT;
    CREATE UNIQUE INDEX saved_views_name ON saved_views(name);
    CREATE INDEX saved_views_place ON saved_views(place_kind, place_id, id);
    CREATE TRIGGER saved_views_no_identity_change
      BEFORE UPDATE OF id ON saved_views
      WHEN NEW.id <> OLD.id
      BEGIN SELECT RAISE(ABORT, 'saved view identity is immutable'); END;
  `,
}];
