import type { SchemaStep } from "../../../protocol/platform/mod.ts";

// GLOB은 문자 클래스 하나마다 패턴 길이를 세므로 긴 패턴은 거절된다(versions 표와 같다).
// 접두사·정확한 길이를 여기서 고정하고 문자 집합은 행을 읽는 쪽에서 schema로 다시 검사한다.
const idCheck = (prefix: string, column = "id") =>
  `${column} GLOB '${prefix}_*' AND length(${column}) = ${
    prefix.length + 1 + 26
  }`;
const SEQ = (column = "revision") =>
  `length(${column}) > 0 AND substr(${column}, 1, 1) BETWEEN '1' AND '9'` +
  ` AND ${column} NOT GLOB '*[^0-9]*'` +
  ` AND (length(${column}) < 19 OR` +
  ` (length(${column}) = 19 AND ${column} <= '9223372036854775807'))`;

// series·series_instances·series_keys 표(domain-model/documents/series ledger 표).
// 가족의 (place, name) 예약은 보관 후에도 남는다. 영구 삭제 경로는 없다.
// 최신 구성 값(order·draft)은 정본 JSON으로 둔다.
export const seriesSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.series.tables",
  sql: `
    CREATE TABLE series (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("ser")}),
      place_kind TEXT NOT NULL CHECK (place_kind IN ('project', 'app')),
      place_id TEXT NOT NULL CHECK (length(place_id) > 0),
      name TEXT NOT NULL CHECK (length(name) > 0),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      format TEXT NOT NULL CHECK (length(format) > 0),
      "order" TEXT NOT NULL CHECK (length("order") > 0),
      next_rule TEXT NOT NULL CHECK (length(next_rule) > 0),
      draft TEXT,
      revision TEXT NOT NULL CHECK (${SEQ("revision")}),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
    ) STRICT;
    CREATE UNIQUE INDEX series_place_name
      ON series(place_kind, place_id, name);
    CREATE INDEX series_place_status
      ON series(place_kind, place_id, status, id);
    CREATE TRIGGER series_no_identity_change
      BEFORE UPDATE OF id ON series
      WHEN NEW.id <> OLD.id
      BEGIN SELECT RAISE(ABORT, 'series identity is immutable'); END;
    CREATE TRIGGER series_no_delete BEFORE DELETE ON series
      BEGIN SELECT RAISE(ABORT, 'series are archived, not deleted'); END;

    CREATE TABLE series_instances (
      series TEXT NOT NULL REFERENCES series(id),
      document TEXT NOT NULL CHECK (${idCheck("doc", "document")}),
      key TEXT NOT NULL CHECK (
        length(key) > 0 AND length(trim(key)) = length(key)
      ),
      order_value TEXT,
      order_version TEXT,
      revision TEXT NOT NULL CHECK (${SEQ("revision")}),
      PRIMARY KEY (series, document),
      UNIQUE (series, key),
      CHECK (
        (order_value IS NULL AND order_version IS NULL) OR
        (order_value IS NOT NULL AND order_version IS NOT NULL
          AND length(order_value) > 0)
      )
    ) STRICT;
    CREATE INDEX series_instances_series ON series_instances(series, revision);
    CREATE INDEX series_instances_document ON series_instances(document);

    CREATE TABLE series_keys (
      series TEXT NOT NULL REFERENCES series(id),
      key TEXT NOT NULL CHECK (
        length(key) > 0 AND length(trim(key)) = length(key)
      ),
      document TEXT NOT NULL CHECK (${idCheck("doc", "document")}),
      first_seq TEXT NOT NULL CHECK (${SEQ("first_seq")}),
      PRIMARY KEY (series, key)
    ) STRICT;
    CREATE INDEX series_keys_document ON series_keys(document);
  `,
}];
