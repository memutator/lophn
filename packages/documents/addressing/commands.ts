import { err, ok, type Result } from "../../base/mod.ts";
import {
  type PlaceName,
  type PlaceNameReservation,
  placeNameSchema,
  type PlaceRef,
  placeRefSchema,
  revisionSchema,
  type Slug,
  slugSchema,
} from "../../contracts/documents/mod.ts";
import type { Seq, Tx } from "../../contracts/platform/mod.ts";
import { type DocumentName, documentNameSchema } from "./model.ts";

function invalidInput(): Result<never> {
  return err({ code: "invalid_input", message: "invalid name reservation" });
}

function invalidStoredRow(): Result<never> {
  return err({ code: "internal", message: "invalid stored name reservation" });
}

function conflict(): Result<never> {
  return err({ code: "conflict", message: "name is already reserved" });
}

// caller는 매 command의 현재 guarded Tx를 넘긴다. factory는 transaction을 열거나 commit하지 않는다.
export function createPlaceNameReservation(
  tx: Pick<Tx, "sql">,
): PlaceNameReservation {
  const get = (slug: Slug): Result<PlaceName | null> => {
    if (!slugSchema.safeParse(slug).success) return invalidInput();
    const row = tx.sql.get(
      "SELECT slug, kind, target, reserved_seq FROM place_names WHERE slug = ?",
      [slug],
    );
    if (row === undefined) return ok(null);
    const parsed = placeNameSchema.safeParse(row);
    if (!parsed.success || parsed.data.slug !== slug) return invalidStoredRow();
    return ok(parsed.data);
  };
  return {
    get,
    reserve(slug, place, reserved_seq) {
      if (
        !slugSchema.safeParse(slug).success ||
        !placeRefSchema.safeParse(place).success ||
        !revisionSchema.safeParse(reserved_seq).success
      ) return invalidInput();
      const existing = get(slug);
      if (!existing.ok) return existing;
      if (existing.value !== null) {
        return existing.value.kind === place.kind &&
            existing.value.target === place.id
          ? ok(undefined)
          : conflict();
      }
      tx.sql.run(
        "INSERT INTO place_names (slug, kind, target, reserved_seq) VALUES (?, ?, ?, ?)",
        [slug, place.kind, place.id, reserved_seq],
      );
      return ok(undefined);
    },
  };
}

export interface DocumentNameReservation {
  get(place: PlaceRef, name: Slug): Result<DocumentName | null>;
  reserve(
    place: PlaceRef,
    name: Slug,
    document: string,
    reserved_seq: Seq,
  ): Result<void>;
}

export function createDocumentNameReservation(
  tx: Pick<Tx, "sql">,
): DocumentNameReservation {
  const get = (place: PlaceRef, name: Slug): Result<DocumentName | null> => {
    if (
      !placeRefSchema.safeParse(place).success ||
      !slugSchema.safeParse(name).success
    ) return invalidInput();
    const row = tx.sql.get(
      `SELECT place_kind, place_id, name, document, reserved_seq FROM document_names
       WHERE place_kind = ? AND place_id = ? AND name = ?`,
      [place.kind, place.id, name],
    );
    if (row === undefined) return ok(null);
    const parsed = documentNameSchema.safeParse(row);
    if (
      !parsed.success || parsed.data.place_kind !== place.kind ||
      parsed.data.place_id !== place.id || parsed.data.name !== name
    ) return invalidStoredRow();
    return ok(parsed.data);
  };
  return {
    get,
    reserve(place, name, document, reserved_seq) {
      if (!placeRefSchema.safeParse(place).success) return invalidInput();
      const parsed = documentNameSchema.safeParse({
        place_kind: place.kind,
        place_id: place.id,
        name,
        document,
        reserved_seq,
      });
      if (!parsed.success) return invalidInput();
      const existing = get(place, name);
      if (!existing.ok) return existing;
      if (existing.value !== null) {
        return existing.value.document === document
          ? ok(undefined)
          : conflict();
      }
      tx.sql.run(
        `INSERT INTO document_names (place_kind, place_id, name, document, reserved_seq)
         VALUES (?, ?, ?, ?, ?)`,
        [place.kind, place.id, name, document, reserved_seq],
      );
      return ok(undefined);
    },
  };
}
