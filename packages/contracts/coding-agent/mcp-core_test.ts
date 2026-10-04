import { assert, assertEquals } from "@std/assert";
import {
  doc,
  fileInput,
  format,
  hash,
  key,
  place,
  project,
  version,
} from "../documents/document-fixtures.ts";
import {
  MCP_CORE_TOOLS,
  mcpCoreTool,
  projectCurrentInputSchema,
} from "./mcp-core.ts";

const tool = (name: string) => {
  const found = mcpCoreTool(name);
  if (!found) throw new Error(name);
  return found;
};

Deno.test("coding-agent/mcp-server#R8, coding-agent/mcp-server#R9, coding-agent/mcp-server#R11: index·project·document op와 list 1~500", () => {
  assertEquals(MCP_CORE_TOOLS.map((item) => item.name), [
    "lophn_index",
    "lophn_project",
    "lophn_document",
    "lophn_read",
    "lophn_save",
    "lophn_format",
    "lophn_series",
  ]);
  const index = tool("lophn_index");
  assertEquals(index.ops, [
    "root",
    "place",
    "context",
    "document",
    "section",
    "search",
    "status",
  ]);
  assertEquals(index.scope, "S");
  assertEquals(index.readOnlyHint, true);
  index.input.parse({ op: "root" });
  index.input.parse({ op: "place", place });
  index.input.parse({ op: "search", query: "plan", place });
  assertEquals(index.input.safeParse({ op: "home" }).success, false);
  assertEquals(index.input.safeParse({ op: "place" }).success, false);

  const projectTool = tool("lophn_project");
  assertEquals(projectTool.ops, ["list", "show", "current"]);
  projectTool.input.parse({ op: "show", project });
  projectTool.input.parse({ op: "current" });
  assertEquals(projectCurrentInputSchema.parse({}), {});
  assertEquals(
    projectTool.input.safeParse({ op: "current", cwd: "/work" }).success,
    false,
  );
  assertEquals(
    projectTool.input.safeParse({ op: "register", project }).success,
    false,
  );

  const document = tool("lophn_document");
  assertEquals(document.ops, ["list", "history", "diff"]);
  document.input.parse({ op: "list", place, limit: 500 });
  document.input.parse({ op: "list", unplaced: true, limit: 1 });
  assertEquals(
    document.input.safeParse({ op: "list", limit: 501 }).success,
    false,
  );
  assertEquals(
    document.input.safeParse({ op: "list", limit: 0 }).success,
    false,
  );
  assertEquals(
    document.input.safeParse({ op: "list", place, unplaced: true }).success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R10, coding-agent/mcp-server#R12, coding-agent/mcp-server#R13: read·diff·save는 documents 입력을 쓰고 series면 key가 필수다", () => {
  const read = tool("lophn_read");
  assertEquals(read.ops, []);
  assertEquals(read.readOnlyHint, true);
  read.input.parse({
    reference: { document: doc, version, section: null },
  });
  assertEquals(
    read.input.safeParse({ reference: { document: doc, version } }).success,
    false,
  );

  const document = tool("lophn_document");
  document.input.parse({
    op: "diff",
    document: doc,
    before: version,
    after: version,
  });
  assertEquals(
    document.input.safeParse({ op: "diff", document: doc, before: version })
      .success,
    false,
  );

  const save = tool("lophn_save");
  assertEquals(save.readOnlyHint, undefined);
  assertEquals(save.scope, "S");
  save.input.parse({
    files: [fileInput],
    place,
    slug: "report",
    title: "보고서",
    format,
    idempotency_key: key,
  });
  save.input.parse({
    files: [fileInput],
    series: { series: "ser_01arz3ndektsv4rrffq69g5fav" },
    key: "1",
  });
  assertEquals(
    save.input.safeParse({
      files: [fileInput],
      series: { series: "ser_01arz3ndektsv4rrffq69g5fav" },
    }).success,
    false,
  );
  assertEquals(
    save.input.safeParse({ files: [fileInput], tags: ["a"] }).success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R14, coding-agent/mcp-server#R16: format은 list·show·validate, series는 list·show·next만이다", () => {
  const formatTool = tool("lophn_format");
  assertEquals(formatTool.scope, "G");
  assertEquals(formatTool.readOnlyHint, undefined);
  assertEquals(formatTool.ops, ["list", "show", "validate"]);
  formatTool.input.parse({ op: "list" });
  formatTool.input.parse({ op: "show", name: "document", module_hash: hash });
  formatTool.input.parse({
    op: "validate",
    name: "document",
    module_hash: hash,
    files: [fileInput],
  });
  assertEquals(formatTool.input.safeParse({ op: "extract" }).success, false);

  const series = tool("lophn_series");
  assertEquals(series.ops, ["list", "show", "next"]);
  assertEquals(series.readOnlyHint, true);
  series.input.parse({ op: "list", place });
  series.input.parse({
    op: "next",
    selector: { place, name: "notes" },
  });
  assertEquals(series.input.safeParse({ op: "create", place }).success, false);
  assert(tool("lophn_project").scope === "S");
});
