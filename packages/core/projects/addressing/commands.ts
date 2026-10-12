import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Document,
  documentMove,
  documentMoved,
  documentRename,
  documentRenamed,
  type PlaceName,
  type PlaceNameReservation,
  placeNameSchema,
  type PlaceRef,
  placeRefSchema,
  revisionSchema,
  type Slug,
  slugSchema,
} from "../../../protocol/projects/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Seq,
  type Tx,
} from "../../../protocol/platform/mod.ts";
import {
  authorizeDocument,
  loadDocument,
  replaceDocument,
} from "../versions/mod.ts";
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

// move·rename은 사람 또는 사람이 고른 정확한 option action의 user 경로다(addressing#R9).
// 낡은 base_revision은 conflict다. 옛 예약을 남기고 새 예약을 같은 transaction에 더한다.
export function createDocumentChangeCommands(): {
  move: CommandDefinition<typeof documentMove>;
  rename: CommandDefinition<typeof documentRename>;
} {
  return {
    move: {
      route: documentMove,
      handle(tx, ctx, input, compare) {
        return changePlace(tx, ctx, input.document, compare.base_revision, {
          place: input.place,
          name: input.name,
        });
      },
    },
    rename: {
      route: documentRename,
      handle(tx, ctx, input, compare) {
        return changePlace(tx, ctx, input.document, compare.base_revision, {
          place: undefined,
          name: input.name,
        });
      },
    },
  };
}

type PlaceChange = { place: PlaceRef | null | undefined; name: Slug | null };

function changePlace(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  change: PlaceChange,
): Result<Document> {
  if (parseActor(ctx.actor)?.kind !== "user") {
    return err({ code: "forbidden", message: "place change is user only" });
  }
  const current = loadDocument(tx.sql, id);
  if (!current.ok) return current;
  if (current.value === null) {
    return err({ code: "not_found", message: "document not found" });
  }
  const document = current.value;
  const access = authorizeDocument(tx.port, ctx, routeName(change), {
    kind: "document",
    document,
  });
  if (!access.ok) return access;
  if (document.revision !== base) {
    return err({ code: "conflict", message: "document revision changed" });
  }
  const place = change.place === undefined ? document.place : change.place;
  // rename은 이름만 받으므로 자리를 그대로 둔다. move는 이름까지 정한 값이고, 자리 없음으로
  // 옮기는 move(place null)는 이름도 null이다. 옛 이름은 예약이 남아 같은 문서의 것이다.
  const name = change.place === undefined
    ? change.name ?? document.name
    : change.name;
  if (place === null && name !== null) {
    return err({
      code: "invalid_input",
      message: "placeless document cannot keep a name",
    });
  }
  if (place !== null && name === null) {
    return err({
      code: "invalid_input",
      message: "placed document needs a name",
    });
  }
  if (samePlace(document.place, place) && document.name === name) {
    return err({ code: "invalid_input", message: "place does not change" });
  }
  // 목적지 이름 예약은 없거나 같은 doc이어야 한다. 다른 대상이면 conflict다(addressing#R2).
  if (place !== null && name !== null) {
    const destination = createDocumentNameReservation(tx).get(place, name);
    if (!destination.ok) return destination;
    if (destination.value !== null && destination.value.document !== id) {
      return err({ code: "conflict", message: "name is already reserved" });
    }
    // documents 표의 같은 자리 이름도 검사한다. documents 표가 예약보다 먼저 움직인 문서가 있다.
    const occupied = tx.sql.get(
      `SELECT id FROM documents WHERE place_kind = ? AND place_id = ? AND name = ?`,
      [place.kind, place.id, name],
    );
    const tenant = occupied === undefined ? undefined : occupied["id"];
    if (typeof tenant === "string" && tenant !== id) {
      return err({ code: "conflict", message: "name is already reserved" });
    }
  }
  // 함수로 두지 않는다. emit seq를 예약에 그대로 묶기 위해서다.
  const seq = change.place === undefined
    ? tx.emit(documentRenamed, id, {
      place: document.place,
      before_name: document.name,
      name: name as Slug,
      before_revision: document.revision,
    })
    : tx.emit(documentMoved, id, {
      before_place: document.place,
      before_name: document.name,
      place,
      name,
      before_revision: document.revision,
    });
  if (place !== null && name !== null) {
    const reserved = createDocumentNameReservation(tx).reserve(
      place,
      name,
      id,
      seq,
    );
    if (!reserved.ok) return reserved;
  }
  // place 변경만으로 FileSource·디스크 파일·tracking을 바꾸지 않는다(addressing#R8).
  const next: Document = { ...document, place, name, revision: seq };
  replaceDocument(tx, next);
  return ok(next);
}

function routeName(change: PlaceChange): string {
  return change.place === undefined ? documentRename.name : documentMove.name;
}

function samePlace(before: PlaceRef | null, after: PlaceRef | null): boolean {
  if (before === null || after === null) return before === after;
  return before.kind === after.kind && before.id === after.id;
}
