import { assertEquals } from "@std/assert";
import {
  doc,
  fileInput,
  hash,
  place,
  project,
  version,
} from "../documents/document-fixtures.ts";
import { connectionIdSchema } from "./connections.ts";
import {
  CLI_CORE_COMMANDS,
  CLI_CORE_NAMES,
  cliCommonSchema,
  cliDocumentDiffSchema,
  cliDocumentListSchema,
  cliFormatValidateSchema,
  cliIndexSchema,
  cliProjectCurrentSchema,
  cliReadSchema,
  cliSaveSchema,
  cliSearchSchema,
  cliSeriesNextSchema,
} from "./cli-core.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";

Deno.test("coding-agent/cli#R4, coding-agent/cli#R11, coding-agent/cli#R22: index·search·project·series 위치와 공통 선택값", () => {
  assertEquals(CLI_CORE_NAMES, [
    "index",
    "search",
    "read",
    "document list",
    "document history",
    "document diff",
    "save",
    "format list",
    "format show",
    "format validate",
    "project list",
    "project show",
    "project current",
    "series list",
    "series show",
    "series next",
  ]);
  assertEquals(CLI_CORE_COMMANDS.length, CLI_CORE_NAMES.length);
  cliCommonSchema.parse({
    json: true,
    connection: CAC,
    daemon_url: "http://127.0.0.1:1",
    app: "notes",
    input: "{}",
  });
  assertEquals(connectionIdSchema.safeParse(CAC).success, true);
  assertEquals(
    cliCommonSchema.safeParse({ input: "{}", input_file: "in.json" }).success,
    false,
  );
  cliIndexSchema.parse({ command: "index", op: "place", place, json: true });
  assertEquals(
    cliIndexSchema.safeParse({ command: "index", op: "place" }).success,
    false,
  );
  cliSearchSchema.parse({ command: "search", query: "plan", place });
  assertEquals(
    cliSearchSchema.safeParse({ command: "search", query: " " }).success,
    false,
  );
  cliProjectCurrentSchema.parse({
    command: "project current",
    connection: CAC,
  });
  assertEquals(
    cliProjectCurrentSchema.safeParse({
      command: "project current",
      cwd: "/work",
    }).success,
    false,
  );
  cliSeriesNextSchema.parse({
    command: "series next",
    selector: { place, name: "notes" },
  });
  assertEquals(
    cliSeriesNextSchema.safeParse({ command: "series create", place }).success,
    false,
  );
});

Deno.test("coding-agent/cli#R12, coding-agent/cli#R13, coding-agent/cli#R14, coding-agent/cli#R15: read·diff·list·save", () => {
  cliReadSchema.parse({
    command: "read",
    reference: { document: doc, version, section: null },
    json: true,
  });
  cliDocumentDiffSchema.parse({
    command: "document diff",
    document: doc,
    before: version,
    after: version,
    base_revision: version,
  });
  assertEquals(
    cliDocumentDiffSchema.safeParse({
      command: "document diff",
      document: doc,
      before: version,
    }).success,
    false,
  );
  cliDocumentListSchema.parse({
    command: "document list",
    unplaced: true,
    limit: 500,
  });
  assertEquals(
    cliDocumentListSchema.safeParse({
      command: "document list",
      place,
      unplaced: true,
    }).success,
    false,
  );
  assertEquals(
    cliDocumentListSchema.safeParse({ command: "document list", limit: 501 })
      .success,
    false,
  );
  cliSaveSchema.parse({
    command: "save",
    paths: ["/work/report.md"],
    place,
    slug: "report",
    title: "보고서",
    format: { name: "document", module_hash: hash, explicit: true },
    idempotency_key: "save-1",
  });
  assertEquals(
    cliSaveSchema.safeParse({
      command: "save",
      paths: ["report.md"],
      series: { series: "ser_01arz3ndektsv4rrffq69g5fav" },
    }).success,
    false,
  );
  void project;
});

Deno.test("coding-agent/cli#R15: format validate는 files와 paths 중 정확히 하나만 받는다", () => {
  const base = {
    command: "format validate",
    name: "document",
    module_hash: hash,
  };
  cliFormatValidateSchema.parse({ ...base, paths: ["/work/report.md"] });
  cliFormatValidateSchema.parse({ ...base, files: [fileInput] });
  assertEquals(cliFormatValidateSchema.safeParse(base).success, false);
  assertEquals(
    cliFormatValidateSchema.safeParse({
      ...base,
      paths: ["/work/report.md"],
      files: [fileInput],
    }).success,
    false,
  );
  assertEquals(
    cliFormatValidateSchema.safeParse({ ...base, paths: ["report.md"] })
      .success,
    false,
  );
  assertEquals(
    cliFormatValidateSchema.safeParse({ ...base, paths: [] }).success,
    false,
  );
});
