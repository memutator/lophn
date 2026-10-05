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
import {
  authorizeDocument,
  loadDocument,
  loadLatestVersion,
  loadVersionByNumber,
} from "../versions/mod.ts";
import {
  createDocumentNameReservation,
  createPlaceNameReservation,
} from "./commands.ts";

function notFound(message = "address does not resolve"): Result<never> {
  return err({ code: "not_found", message });
}

// section 해석의 근원(documents/addressing#R4, R5). 선택 고정 판의 section
// 목록을 주입해 받는다. outlines는 비동기 extraction 근원이라 read가 조립한다.
export type SectionSource = {
  // 고정 판의 section 목록. 없는 판·읽지 못한 판은 err로 같은 미확인이다.
  sections(version: string): Result<readonly StoredSection[]>;
};

export type StoredSection = {
  key: string;
  title: string;
  parent: string | null;
};

const resolveOutputSchema = z.object({
  resolved: resolvedAddressSchema,
  as_of_seq: z.string(),
  next_cursor: z.string().nullable(),
});
type ResolveOutput = Result<z.output<typeof resolveOutputSchema>>;

// 현재 target에 대한 범위를 다시 검사한다. 안내로 권한을 넓히지 않는다(addressing#R6).
// 범위 밖은 존재를 알려주지 않는다. not_found와 정확히 같은 응답으로 답한다(platform/identity#R10).
function allowed(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  document: { id: string; place: PlaceRef | null },
): Result<null> {
  const decision = authorizeDocument(snapshot.port, ctx, operation, {
    kind: "document",
    document: document as never,
  });
  // forbidden·not_found는 모두 부재로 답한다. 범위 밖은 존재를 알려주지 않는다.
  if (!decision.ok && decision.error.code === "forbidden") return notFound();
  if (!decision.ok) return decision;
  return ok(null);
}

export function createAddressingReads(sectionSource?: SectionSource): {
  resolve: ReadDefinition<typeof documentResolve>;
} {
  return {
    resolve: {
      route: documentResolve,
      handle(snapshot, ctx, input) {
        const reference = input.reference;
        if ("place" in reference) {
          return resolveAddress(snapshot, ctx, reference, sectionSource);
        }
        return resolveRef(snapshot, ctx, reference, sectionSource);
      },
    },
  };
}

function resolveAddress(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  reference: Address,
  sectionSource?: SectionSource,
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
  const decision = allowed(snapshot, ctx, documentResolve.name, loaded.value);
  if (!decision.ok) return decision as never;
  const document = loaded.value;
  const version = pickVersion(snapshot, document.id, reference.version);
  if (!version.ok) return version as never;
  const slug = liveSlug(snapshot, document.place);
  const section = reference.section === null
    ? ok("whole" as const)
    : resolveSection(
      version.value.id,
      reference.section,
      sectionSource,
    );
  if (!section.ok) return section as never;
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
      section_status: section.value,
    },
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

function resolveRef(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  reference: DocumentRef,
  sectionSource?: SectionSource,
): ResolveOutput {
  const loaded = loadDocument(snapshot.sql as never, reference.document);
  if (!loaded.ok) return loaded as never;
  if (loaded.value === null) return notFound();
  const decision = allowed(snapshot, ctx, documentResolve.name, loaded.value);
  if (!decision.ok) return decision as never;
  const document = loaded.value;
  const version = pickVersion(snapshot, document.id, null);
  if (!version.ok) return version as never;
  const versionRef = reference.version ?? version.value.id;
  const section = reference.section === null
    ? ok("whole" as const)
    : resolveSection(
      versionRef,
      reference.section,
      sectionSource,
    );
  if (!section.ok) return section as never;
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
      section_status: section.value,
    },
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

// section 해석(documents/addressing#R4, R5). 조상 이름을 /로 이은 전체 경로를
// 우선하고 문서 안에서 유일한 마지막 이름만으로도 찾는다. 중복이면 모호함
// (invalid_input)이다. 같은 key만 이어지고 유사 section redirect는 없다.
function resolveSection(
  version: string,
  reference: string,
  sectionSource?: SectionSource,
): Result<"whole" | "found" | "missing" | "unverified" | "unsupported"> {
  if (sectionSource === undefined) return ok("unverified");
  const loaded = sectionSource.sections(version);
  if (!loaded.ok) return ok("unverified");
  const stored = loaded.value;
  if (stored.length === 0) return ok("unsupported");
  // 전체 경로(조상 이름/마지막 이름) 우선.
  const parts = reference.split("/").filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  if (parts.length > 1) {
    const byPath = stored.filter((section) =>
      pathOf(stored, section) === reference
    );
    if (byPath.length === 1) return ok("found");
    // 전체 경로가 없으면 missing이다. 유사 section으로 redirect하지 않는다.
    if (byPath.length === 0) return ok("missing");
    return err({
      code: "invalid_input",
      message: "address is ambiguous",
    });
  }
  const byName = stored.filter((section) => section.title === last);
  if (byName.length === 1) return ok("found");
  if (byName.length === 0) return ok("missing");
  return err({ code: "invalid_input", message: "address is ambiguous" });
}

// 조상 이름을 /로 이은 전체 경로. parent 사슬의 title을 붙인다.
function pathOf(
  stored: readonly StoredSection[],
  section: StoredSection,
): string {
  const names: string[] = [section.title];
  let parent = section.parent;
  let guard = 0;
  while (parent !== null && guard < 32) {
    const found = stored.find((item) => item.key === parent);
    if (found === undefined) break;
    names.unshift(found.title);
    parent = found.parent;
    guard += 1;
  }
  return names.join("/");
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
