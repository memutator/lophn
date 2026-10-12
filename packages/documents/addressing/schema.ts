import type { SchemaStep } from "../../protocol/platform/mod.ts";

// owner 표와 foreign key로 묶으면 보관·place 해제가 예약 수명을 바꿀 수 있다.
export const addressingSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.addressing.names",
  sql: `
    CREATE TABLE place_names (
      slug TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      reserved_seq TEXT NOT NULL
    ) STRICT;
    CREATE INDEX place_names_target ON place_names(kind, target);
    CREATE TABLE document_names (
      place_kind TEXT NOT NULL,
      place_id TEXT NOT NULL,
      name TEXT NOT NULL,
      document TEXT NOT NULL,
      reserved_seq TEXT NOT NULL,
      PRIMARY KEY (place_kind, place_id, name)
    ) STRICT;
    CREATE INDEX document_names_document ON document_names(document);
    CREATE INDEX document_names_place_document
      ON document_names(place_kind, place_id, document);

    CREATE TRIGGER place_names_no_update BEFORE UPDATE ON place_names
    BEGIN SELECT RAISE(ABORT, 'place name reservation is immutable'); END;
    CREATE TRIGGER place_names_no_delete BEFORE DELETE ON place_names
    BEGIN SELECT RAISE(ABORT, 'place name reservation is immutable'); END;
    CREATE TRIGGER place_names_no_replace BEFORE INSERT ON place_names
    WHEN EXISTS (SELECT 1 FROM place_names WHERE slug = NEW.slug)
    BEGIN SELECT RAISE(ABORT, 'place name reservation already exists'); END;
    CREATE TRIGGER document_names_no_update BEFORE UPDATE ON document_names
    BEGIN SELECT RAISE(ABORT, 'document name reservation is immutable'); END;
    CREATE TRIGGER document_names_no_delete BEFORE DELETE ON document_names
    BEGIN SELECT RAISE(ABORT, 'document name reservation is immutable'); END;
    CREATE TRIGGER document_names_no_replace BEFORE INSERT ON document_names
    WHEN EXISTS (
      SELECT 1 FROM document_names
      WHERE place_kind = NEW.place_kind AND place_id = NEW.place_id AND name = NEW.name
    )
    BEGIN SELECT RAISE(ABORT, 'document name reservation already exists'); END;
  `,
}];
