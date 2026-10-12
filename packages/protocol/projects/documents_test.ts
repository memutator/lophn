import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { commandRequestSchema, routePath } from "../platform/mod.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import {
  agentDocumentSchema,
  DOCUMENT_DISPATCHABLE_COMMANDS,
  DOCUMENT_EVENTS,
  DOCUMENT_ROUTES,
  documentArchive,
  documentCompareSchema,
  documentExport,
  documentGet,
  documentList,
  documentListEntrySchema,
  documentMove,
  documentMoveInputSchema,
  documentPrepare,
  documentRename,
  documentResolve,
  documentRestore,
  documentRestoreInputSchema,
  documentRestoreRequestSchema,
  documentSave,
  documentSaveRequestSchema,
  documentSetSource,
  documentUnarchive,
  documentUpdate,
} from "./documents.ts";
import { saveResultSchema } from "./versions.ts";
import {
  basis,
  doc,
  documentRecord,
  file,
  format,
  hash,
  key,
  metadata,
  place,
  prepared,
  previous,
  project,
  saved,
  version,
  versionRecord,
} from "./document-fixtures.ts";

Deno.test("documents/versions#R1: document routes and events match the architecture table", () => {
  assertEquals(DOCUMENT_ROUTES.map(routePath), [
    "/v1/documents/prepare",
    "/v1/documents/save",
    "/v1/documents/restore",
    "/v1/documents/update",
    "/v1/documents/set_source",
    "/v1/documents/archive",
    "/v1/documents/unarchive",
    "/v1/documents/move",
    "/v1/documents/rename",
    "/v1/documents/list",
    "/v1/documents/get",
    "/v1/documents/resolve",
    "/v1/documents/export",
  ]);
  assertEquals(DOCUMENT_ROUTES.map((route) => route.name), [
    "document.prepare",
    "document.save",
    "document.restore",
    "document.update",
    "document.set_source",
    "document.archive",
    "document.unarchive",
    "document.move",
    "document.rename",
    "document.list",
    "document.get",
    "document.resolve",
    "document.export",
  ]);
  for (const route of DOCUMENT_ROUTES) {
    assertEquals(ROUTES.filter((entry) => entry === route).length, 1);
  }
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Document")).map((event) =>
      event.type
    ).join(","),
    DOCUMENT_EVENTS.map((event) => event.type).join(","),
  );
  for (const route of DOCUMENT_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
});

Deno.test("documents/versions#R3: save binds the prepared result, CAS and idempotency key", () => {
  assert(
    documentSaveRequestSchema.safeParse({
      input: prepared,
      compare: { base_version: version },
      idempotency_key: key,
      prepared: ["prep-1"],
    }).success,
  );
  assert(
    !documentSaveRequestSchema.safeParse({
      input: prepared,
      compare: { base_version: previous },
      idempotency_key: key,
      prepared: ["prep-1"],
    }).success,
  );
  assertEquals(documentPrepare.kind, "worker");
  assertEquals(documentSave.kind, "command");
});

Deno.test("documents/versions#R8: get reads the latest or a chosen version and keeps stored bytes", () => {
  const output = {
    document: documentRecord,
    version: versionRecord,
    reference: {
      place: "mahas",
      document: "report",
      section: null,
      version: 1,
    },
    as_of_seq: "9",
    next_cursor: null,
  };
  assert(documentGet.output.safeParse(output).success);
  assert(
    documentGet.output.safeParse({
      ...output,
      document: { ...documentRecord, file_source: undefined },
      version: { ...versionRecord, number: 2 },
    }).success,
  );
  assert(documentGet.input.safeParse({ document: doc }).success);
  assert(documentGet.input.safeParse({ document: doc, version }).success);
  assert(!documentGet.input.safeParse({ document: version }).success);
  assert(!documentGet.input.safeParse({ document: doc, extra: true }).success);
  assertEquals(file.media_type, "text/markdown");
  assert(documentGet.errors.includes("not_found"));
});

Deno.test("documents/versions#R9: list filters place, archive state and count without disk source", () => {
  const entry = {
    document: {
      id: doc,
      title: metadata.title,
      place,
      name: metadata.name,
      latest_version: version,
      revision: "7",
      status: "archived" as const,
    },
    latest_version: {
      id: version,
      document: doc,
      number: 1,
      content_hash: hash,
      format,
      saved_by: "user" as const,
      saved_at: versionRecord.saved_at,
      run: null,
    },
  };
  assert(documentListEntrySchema.safeParse(entry).success);
  assert(!("file_source" in entry.document));
  assert(!("files" in entry.latest_version));
  assertEquals(
    "file_source" in agentDocumentSchema.parse({
      ...entry.document,
      file_source: basis.file_source,
    }),
    false,
  );
  assert(
    documentList.input.safeParse({ place: null, status: "archived", limit: 20 })
      .success,
  );
  assert(
    documentList.output.safeParse({
      documents: [entry],
      as_of_seq: "9",
      next_cursor: "20",
    }).success,
  );
  assert(!documentList.input.safeParse({ status: "deleted" }).success);
  assert(!documentList.input.safeParse({ limit: 0 }).success);
  assert(!documentList.input.safeParse({ place, cursor: "" }).success);
  assertEquals(documentList.actors.includes("machine"), false);
  assert(
    !documentListEntrySchema.safeParse({
      ...entry,
      document: { ...entry.document, place, name: null },
    }).success,
  );
  assert(
    !documentListEntrySchema.safeParse({
      ...entry,
      latest_version: {
        ...entry.latest_version,
        saved_by: "agent:asg_01arz3ndektsv4rrffq69g5fav",
        run: null,
      },
    }).success,
  );
});

Deno.test("documents/versions#R10: restore prepares the chosen version and can return unchanged", () => {
  const input = { document: doc, restore_version: previous, prepared };
  assert(documentRestoreInputSchema.safeParse(input).success);
  assert(
    documentRestoreInputSchema.safeParse({ ...input, title: "복원" }).success,
  );
  assert(
    !documentRestoreInputSchema.safeParse({
      ...input,
      prepared: { ...prepared, base_version: null },
    }).success,
  );
  assert(
    documentRestoreRequestSchema.safeParse({
      input,
      compare: { base_version: version, base_revision: "7" },
      idempotency_key: key,
      prepared: ["prep-1"],
    }).success,
  );
  assert(
    !documentRestoreRequestSchema.safeParse({
      input,
      compare: { base_version: previous, base_revision: "7" },
      idempotency_key: key,
      prepared: ["prep-1"],
    }).success,
  );
  assertEquals(documentRestore.actors, ["user", "machine"]);
  assert(
    saveResultSchema.safeParse({
      ...saved,
      status: "unchanged",
      event_seq: null,
    })
      .success,
  );
});

Deno.test("documents/versions#R16: export keeps selected fixed versions as markdown or json", () => {
  const input = {
    place,
    documents: [{ document: doc, version }],
    format: "markdown" as const,
  };
  assert(documentExport.input.safeParse(input).success);
  assert(documentExport.input.safeParse({ ...input, format: "json" }).success);
  assert(!documentExport.input.safeParse({ ...input, format: "html" }).success);
  assert(!documentExport.input.safeParse({ ...input, documents: [] }).success);
  assert(
    !documentExport.input.safeParse({
      ...input,
      documents: [input.documents[0], input.documents[0]],
    }).success,
  );
  assertEquals(documentExport.actors, ["user"]);
  assert(
    documentExport.output.safeParse({
      format: "json",
      documents: [{
        document: {
          id: doc,
          title: metadata.title,
          place: null,
          name: null,
          latest_version: version,
          revision: "7",
          status: "active",
        },
        version: versionRecord,
        reference: { document: doc, version, section: null },
      }],
    }).success,
  );
  assert(documentExport.errors.includes("conflict"));
});

Deno.test("documents/versions#R11: command inputs reject unknown fields and bad prefixes", () => {
  for (
    const value of [
      { document: project },
      { document: doc, title: "" },
      { document: doc, title: "제목", extra: true },
    ]
  ) assert(!documentUpdate.input.safeParse(value).success);
  assert(!documentSetSource.input.safeParse({ document: doc }).success);
  assert(
    !documentMoveInputSchema.safeParse({ document: doc, place, name: null })
      .success,
  );
  assert(
    documentMoveInputSchema.safeParse({
      document: doc,
      place: null,
      name: null,
    })
      .success,
  );
  assert(!documentCompareSchema.safeParse({ base_revision: "0" }).success);
  assert(
    !commandRequestSchema(documentArchive).safeParse({
      input: { document: doc },
      compare: { base_revision: "7" },
      idempotency_key: "",
      prepared: [],
    }).success,
  );
  assert(
    documentResolve.input.safeParse({
      reference: {
        place: "mahas",
        document: "report",
        section: null,
        version: null,
      },
    }).success,
  );
  assert(
    !documentResolve.input.safeParse({ reference: { document: doc } }).success,
  );
  assertEquals(documentArchive.actors, ["user", "machine"]);
  assertEquals(documentUnarchive.actors, ["user"]);
  assertEquals(documentSetSource.actors, ["user"]);
  assertEquals(documentUpdate.actors, ["user", "coding_agent", "agent"]);
});

Deno.test("documents/addressing#R9: move and rename are dispatchable for a verified user action, archive and restore for a run revert", () => {
  assertEquals(
    DOCUMENT_DISPATCHABLE_COMMANDS.map((item) => item.route.name),
    [
      "document.move",
      "document.rename",
      "document.archive",
      "document.restore",
    ],
  );
  for (const item of DOCUMENT_DISPATCHABLE_COMMANDS) {
    assertEquals(item.dispatchable, true);
    assertEquals(item.route.kind, "command");
  }
  // option action이 부르는 둘은 사람 결정의 user만 받는다.
  assertEquals(documentMove, DOCUMENT_DISPATCHABLE_COMMANDS[0].route);
  assertEquals(documentRename, DOCUMENT_DISPATCHABLE_COMMANDS[1].route);
  assertEquals(documentMove.actors, ["user"]);
  assertEquals(documentRename.actors, ["user"]);
  // revert가 부르는 둘은 사람의 보관·복원과 같은 route다.
  assertEquals(documentArchive, DOCUMENT_DISPATCHABLE_COMMANDS[2].route);
  assertEquals(documentRestore, DOCUMENT_DISPATCHABLE_COMMANDS[3].route);
  assertEquals(documentArchive.actors, ["user", "machine"]);
  assertEquals(documentRestore.actors, ["user", "machine"]);
});
