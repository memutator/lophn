// address 해석 read. place 예약 → place ID, (place ID, 이름) 예약 → 문서.
// 옛 이름·옛 자리도 같은 대상의 현재 참조로 안내하고 안내로 권한을 넓히지 않는다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Address,
  type DocumentRef,
  documentResolve,
  type PlaceRef,
  resolvedAddressSchema,
} from "../../contracts/documents/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import { z } from "zod";
import { authorizeDocument } from "../versions/mod.ts";
import {
  loadDocument,
  loadLatestVersion,
  loadVersionByNumber,
} from "../versions/store.ts";
import {
  createDocumentNameReservation,
  createPlaceNameReservation,
} from "./commands.ts";

function notFound(): Result<never> {
  return err({ code: "not_found", message: "address does not resolve" });
}

const resolveOutputSchema = z.object({
  resolved: resolvedAddressSchema,
  as_of_seq: z.string(),
  next_cursor: z.string().nullable(),
});
type ResolveOutput = Result<z.output<typeof resolveOutputSchema>>;

// 현재 target에 대한 범위를 다시 검사한다. 안내로 권한을 넓히지 않는다(addressing#R6).
function allowed(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  document: { id: string; place: PlaceRef | null },
): boolean {
  return authorizeDocument(snapshot.port, ctx, operation, {
    kind: "document",
    document: document as never,
  }).ok;
}

export function createAddressingReads(): {
  resolve: ReadDefinition<typeof documentResolve>;
} {
  return {
    resolve: {
      route: documentResolve,
      handle(snapshot, ctx, input) {
        const reference = input.reference;
        if ("place" in reference) {
          return resolveAddress(snapshot, ctx, reference);
        }
        return resolveRef(snapshot, ctx, reference);
      },
    },
  };
}

function resolveAddress(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  reference: Address,
): ResolveOutput {
  const place = createPlaceNameReservation({ sql: snapshot.sql as never }).get(
    reference.place,
  );
  if (!place.ok) return place as never;
  if (place.value === null) return notFound();
  const target: PlaceRef = {
    kind: place.value.kind,
    id: place.value.target,
  };
  const name = createDocumentNameReservation({ sql: snapshot.sql as never })
    .get(
      target,
      reference.document,
    );
  if (!name.ok) return name as never;
  if (name.value === null) return notFound();
  const loaded = loadDocument(snapshot.sql as never, name.value.document);
  if (!loaded.ok) return loaded as never;
  if (loaded.value === null) return notFound();
  const document = loaded.value;
  const version = pickVersion(snapshot, document.id, reference.version);
  if (!version.ok) return version as never;
  if (!allowed(snapshot, ctx, documentResolve.name, document)) {
    return err({
      code: "forbidden",
      message: "address target is out of scope",
    });
  }
  const slug = liveSlug(snapshot, document.place);
  const current = document.place === null
    ? {
      document: document.id,
      version: version.value.id,
      section: reference.section,
    }
    : {
      place: slug ?? "",
      document: document.name ?? "",
      section: reference.section,
      version: version.value.number,
    };
  return ok({
    resolved: {
      document: document.id,
      version: version.value.id,
      section: reference.section,
      redirected: reference.place !== slug ||
        reference.document !== document.name,
      current_reference: current,
      section_status: "whole",
    },
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

function resolveRef(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  reference: DocumentRef,
): ResolveOutput {
  const loaded = loadDocument(snapshot.sql as never, reference.document);
  if (!loaded.ok) return loaded as never;
  if (loaded.value === null) return notFound();
  const document = loaded.value;
  const version = pickVersion(snapshot, document.id, null);
  if (!version.ok) return version as never;
  if (!allowed(snapshot, ctx, documentResolve.name, document)) {
    return err({
      code: "forbidden",
      message: "address target is out of scope",
    });
  }
  const versionRef = reference.version ?? version.value.id;
  return ok({
    resolved: {
      document: document.id,
      version: versionRef,
      section: reference.section,
      redirected: false,
      current_reference: {
        document: document.id,
        version: versionRef,
        section: reference.section,
      },
      section_status: "whole",
    },
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

function pickVersion(
  snapshot: ReadSnapshot,
  document: string,
  number: number | null,
): Result<{ id: string; number: number }> {
  const row = number === null
    ? loadLatestVersion(snapshot.sql as never, document)
    : loadVersionByNumber(snapshot.sql as never, document, number);
  if (!row.ok) return row as never;
  if (row.value === null) {
    return err({ code: "not_found", message: "version not found" });
  }
  return ok({ id: row.value.id, number: row.value.number });
}

// 대상 문서의 현재 place 예약 slug. 예약은 지우지 않으므로 예약 행이 항상 남는다.
function liveSlug(
  snapshot: ReadSnapshot,
  place: PlaceRef | null,
): string | null {
  if (place === null) return null;
  const row = snapshot.sql.get(
    "SELECT slug FROM place_names WHERE kind = ? AND target = ? ORDER BY reserved_seq DESC LIMIT 1",
    [place.kind, place.id],
  );
  const slug = row === undefined ? undefined : row["slug"];
  return typeof slug === "string" ? slug : null;
}
