import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import { ROUTES as DOCUMENT_ROUTES } from "../../../contracts/documents/mod.ts";
import { ROUTES } from "../../../contracts/lophn-agent/mod.ts";
import {
  productPresetDefinition,
  ROLE_CAPS,
  validateDefinition,
  type ValidateDeps,
} from "../../presets/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  createDocumentToolHandlers,
  createFormatToolHandlers,
  DOCUMENT_READ_TOOL_NAMES,
  DOCUMENT_TOOLS,
  DOCUMENT_WRITE_TOOL_NAMES,
  executeTool,
  FORMAT_TOOL_NAMES,
  FORMAT_TOOLS,
  listTools,
  type RunCredential,
  runOperations,
  TOOL_BUNDLES,
} from "./mod.ts";

// 문서·format 묶음의 정의와 handler. 소유 contract(documents)는 메모리 fake로 흉내 낸다. 실제 core와
// 실제 documents worker를 거친 확인은 apps/core/document-tools_test.ts가 한다. 이 시험은 model
// provider를 부르지 않는다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const CALL = id("tcl", 1);
const PROJECT = id("prj", 1);
const PLACE = { kind: "project" as const, id: PROJECT };
const FORMAT_HASH = "f".repeat(64);

type Call = { contract: string; input: Record<string, unknown>; run: string };

type StoredVersion = { id: string; text: string };
type StoredDocument = {
  id: string;
  title: string;
  place: typeof PLACE | null;
  name: string | null;
  versions: StoredVersion[];
  // 원본 연결 문서 같은 agent 출력 불가 상태.
  locked: boolean;
};

// documents의 목록·본문·이력·저장을 흉내 내는 메모리 world다. cursor는 offset 문자열이다.
function documentsWorld() {
  const documents = new Map<string, StoredDocument>();
  const calls: Call[] = [];
  const saved = new Map<string, unknown>();
  let versionSeq = 100;
  let unavailable = false;
  // Operator가 승인한 출력 문서. null이면 제한이 없다.
  let outputs: Set<string> | null = null;
  const world = {
    documents,
    calls,
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    setOutputs(value: Set<string> | null) {
      outputs = value;
    },
    seed(
      n: number,
      versions: string[],
      options: { locked?: boolean; name?: string | null } = {},
    ): StoredDocument {
      const document: StoredDocument = {
        id: id("doc", n),
        title: `문서 ${n}`,
        place: PLACE,
        name: options.name === undefined ? `doc-${n}` : options.name,
        versions: versions.map((text) => ({
          id: id("ver", ++versionSeq),
          text,
        })),
        locked: options.locked ?? false,
      };
      documents.set(document.id, document);
      return document;
    },
    call(
      contract: string,
      input: unknown,
      run: string,
    ): Promise<Result<unknown>> {
      const body = input as Record<string, unknown>;
      calls.push({ contract, input: body, run });
      return Promise.resolve(world.handle(contract, body));
    },
    handle(contract: string, body: Record<string, unknown>): Result<unknown> {
      switch (contract) {
        case "document.list": {
          const all = [...documents.values()];
          const offset = body["cursor"] === undefined
            ? 0
            : Number(body["cursor"]);
          const limit = Number(body["limit"] ?? 50);
          const page = all.slice(offset, offset + limit);
          return ok({
            as_of_seq: "1",
            documents: page.map((document) => ({
              document: { id: document.id, title: document.title },
              latest_version: {
                id: document.versions[document.versions.length - 1].id,
              },
            })),
            next_cursor: offset + limit < all.length
              ? String(offset + limit)
              : null,
          });
        }
        case "document.history": {
          const document = documents.get(String(body["document"]));
          if (document === undefined || document.locked) return notFound();
          const offset = body["cursor"] === undefined
            ? 0
            : Number(body["cursor"]);
          const all = document.versions;
          const page = all.slice(offset, offset + 50);
          return ok({
            as_of_seq: "1",
            document: document.id,
            versions: page.map((version) => ({ id: version.id })),
            next_cursor: offset + 50 < all.length ? String(offset + 50) : null,
          });
        }
        case "document.read": {
          const reference = body["reference"] as {
            document: string;
            version: string;
          };
          const document = documents.get(reference.document);
          const version = document?.versions.find((candidate) =>
            candidate.id === reference.version
          );
          if (document === undefined || version === undefined) {
            return notFound();
          }
          return ok({
            as_of_seq: "1",
            document: document.id,
            version: version.id,
            latest_version: document.versions[document.versions.length - 1].id,
            format: { name: "document" },
            module_hash: FORMAT_HASH,
            section: body["section"] ?? null,
            section_status: "whole",
            include_children: false,
            ranges: [{
              start_line: 1,
              end_line: version.text.split("\n").length,
            }],
            text: version.text,
            redacted: false,
            failure_reason: null,
            omission_reason: null,
            file: null,
            complete: true,
            next_cursor: null,
          });
        }
        case "document.diff":
          return ok({
            as_of_seq: "1",
            document: body["document"],
            additions: Array.from({ length: 400 }, (_, index) => ({
              range: { start_line: index + 1, end_line: index + 1 },
              text: `추가된 줄 ${index} ${"가".repeat(60)}`,
            })),
            deletions: [],
            omissions: [],
            next_cursor: null,
          });
        case "format.list":
          return ok({
            as_of_seq: "1",
            formats: [{
              name: "document",
              module_hash: FORMAT_HASH,
              media_types: ["text/markdown"],
              structure: { sections: true },
              metadata: {},
              template: [],
              guide: { text: "제목 아래 본문을 쓴다", examples: ["# 제목"] },
              vocabulary: [],
              extracts: true,
            }],
          });
        case "format.get":
          return ok({
            as_of_seq: "1",
            name: body["name"],
            module_hash: body["module_hash"],
            media_types: ["text/markdown"],
            structure: { sections: true },
            metadata: {},
            template: [],
            guide: {
              text: "제목 아래 본문을 쓴다",
              examples: ["# 제목", "## 절"],
            },
            vocabulary: [{ name: "절", description: "section" }],
            extracts: true,
          });
        case "ValidateToolText": {
          const text = String(body["text"]);
          const failed = text.includes("깨짐");
          return ok({
            input_hash: "a".repeat(64),
            module_hash: FORMAT_HASH,
            status: failed ? "failed" : "passed",
            error_count: failed ? 1 : 0,
            warning_count: 0,
            diagnostics_offset: 0,
            diagnostics: failed
              ? [{
                severity: "error",
                code: "broken",
                message: "깨졌다",
                file: null,
                start_line: null,
                end_line: null,
                column: null,
              }]
              : [],
            complete: true,
            next_cursor: null,
          });
        }
        case "SaveToolDocument": {
          if (unavailable) {
            return err({ code: "unavailable", message: "no answer" });
          }
          const key = String(body["idempotency_key"]);
          if (saved.has(key)) return ok(saved.get(key));
          const base = body["base_version"] as string | null;
          let document = documents.get(String(body["document"]));
          if (base === null) {
            if (document !== undefined) {
              return err({ code: "conflict", message: "exists" });
            }
            const metadata = body["metadata"] as {
              title: string;
              place: typeof PLACE | null;
              name: string | null;
            };
            document = {
              id: String(body["document"]),
              title: metadata.title,
              place: metadata.place,
              name: metadata.name,
              versions: [],
              locked: false,
            };
            documents.set(document.id, document);
          } else {
            if (document === undefined || document.locked) return notFound();
            if (outputs !== null && !outputs.has(document.id)) {
              return notFound();
            }
            const latest = document.versions[document.versions.length - 1];
            if (latest.id !== base) {
              return err({ code: "conflict", message: "changed" });
            }
            if (latest.text === body["text"]) {
              const result = result_(document, latest.id, "unchanged");
              saved.set(key, result);
              return ok(result);
            }
          }
          const version = {
            id: id("ver", ++versionSeq),
            text: String(body["text"]),
          };
          document.versions.push(version);
          const result = result_(document, version.id, "saved");
          saved.set(key, result);
          return ok(result);
        }
        default:
          return err({ code: "invalid_input", message: contract });
      }
    },
  };
  return world;
}

function result_(
  document: StoredDocument,
  version: string,
  status: "saved" | "unchanged",
) {
  return {
    status,
    document: document.id,
    version,
    reference: { document: document.id, version, section: null },
    warnings: [],
    event_seq: status === "saved" ? "7" : null,
  };
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "no such document" });
}

function credential(call: string | undefined = CALL): RunCredential {
  const contracts = new Set<string>();
  for (const tool of BUILTIN_TOOLS) contracts.add(tool.contract);
  return {
    run: RUN,
    targets: new Set(),
    operations: contracts,
    ...(call === undefined ? {} : { call }),
  };
}

function rig(options: { names?: readonly string[] } = {}) {
  const world = documentsWorld();
  const names = options.names ?? BUILTIN_TOOLS.map((tool) => tool.name);
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: names, roleTools: names },
  );
  const ports = {
    call: world.call,
    newId: (prefix: "qst" | "run") => id(prefix === "qst" ? "qst" : "run", 9),
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "lophn" as const,
        original_message: id("msg", 1),
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
      })),
  };
  const handlers = createBuiltinToolHandlers(ports);
  return {
    world,
    listed,
    run: (tool: string, input: unknown, call?: string) =>
      executeTool(
        { listed, handlers, credential: credential(call) },
        tool,
        input,
      ),
  };
}

function contentOf(outcome: { result: { content: unknown } }) {
  return outcome.result.content as Record<string, unknown>;
}

const NAMES_THE_ROLES_MAY_NOT_HAVE = [
  "document.delete",
  "document.move",
  "document.rename",
  "document.archive",
  "document.restore",
  "document.unarchive",
  "document.export",
  "document.set_source",
  "document.update",
  "series.create",
  "series.add_instance",
  "home.list",
];

Deno.test("lophn-agent/harness/tools#R6: 문서 tool은 읽기 여덟과 쓰기 둘이고 각각 소유 contract 하나를 가리키며 직접 관리 동작은 정의에 없다", () => {
  assertEquals(
    DOCUMENT_TOOLS.map((tool) => [tool.name, tool.effect]),
    [
      ["document.list", "read"],
      ["document.outline", "read"],
      ["document.search", "read"],
      ["document.read_version", "read"],
      ["document.read_section", "read"],
      ["document.read_range", "read"],
      ["document.history", "read"],
      ["document.diff", "read"],
      ["document.create", "write"],
      ["document.save_version", "write"],
    ],
  );
  const owned = new Set<string>([
    ...DOCUMENT_ROUTES.map((route) => route.name),
    ...ROUTES.map((route) => route.name),
  ]);
  for (const tool of [...DOCUMENT_TOOLS, ...FORMAT_TOOLS]) {
    assert(owned.has(tool.contract), `${tool.name} → ${tool.contract}`);
    assertEquals(tool.confirm, false, tool.name);
  }
  // 직접 삭제·이동·이름 변경·보관·시리즈·Home 동작은 어느 묶음에도 역할 상한에도 없다.
  const defined = new Set(BUILTIN_TOOLS.map((tool) => tool.name));
  for (const name of NAMES_THE_ROLES_MAY_NOT_HAVE) {
    assertEquals(defined.has(name), false, name);
    for (const [role, cap] of ROLE_CAPS) {
      assertEquals(cap.tools.includes(name), false, `${role} ${name}`);
    }
  }
  // 모든 쓰기 tool은 새 판 저장 한 contract만 부르고 읽기 tool은 읽기 route만 부른다.
  const reads = new Set(
    [...DOCUMENT_ROUTES, ...ROUTES].filter((route) =>
      route.kind === "read" || route.kind === "worker"
    ).map((route) => route.name),
  );
  for (const tool of DOCUMENT_TOOLS.filter((tool) => tool.effect === "read")) {
    assert(reads.has(tool.contract), `${tool.name} → ${tool.contract}`);
  }
  for (const tool of DOCUMENT_TOOLS.filter((tool) => tool.effect === "write")) {
    assertEquals(tool.contract, "SaveToolDocument");
  }
});

Deno.test("lophn-agent/harness/tools#R6: 네 역할 상한의 문서·format 이름은 모두 정의가 있고 역할 목록은 상한 안의 이름만 낸다", () => {
  const defined = new Set(BUILTIN_TOOLS.map((tool) => tool.name));
  for (const [role, cap] of ROLE_CAPS) {
    for (const name of cap.tools) {
      if (name.startsWith("document.") || name.startsWith("format.")) {
        assert(defined.has(name), `${role} ${name} has no definition`);
      }
    }
    const listed = listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      { presetTools: [...defined], roleTools: cap.tools },
    ).map((tool) => tool.name);
    for (const name of listed) assert(cap.tools.includes(name), name);
  }
});

Deno.test("lophn-agent/roles/common#R6: Operator는 새 문서 tool 없이 새 version 저장만 갖고 나머지 세 역할은 둘 다 갖는다", () => {
  const listedFor = (role: string) =>
    listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      {
        presetTools: BUILTIN_TOOLS.map((tool) => tool.name),
        roleTools: ROLE_CAPS.get(role)!.tools,
      },
    ).map((tool) => tool.name);
  const operator = listedFor("operator");
  assert(operator.includes("document.save_version"));
  assertEquals(operator.includes("document.create"), false);
  for (const role of ["lophn", "app_engineer", "context_engineer"]) {
    const names = listedFor(role);
    assert(names.includes("document.create"), role);
    assert(names.includes("document.save_version"), role);
  }
});

Deno.test("lophn-agent/roles/common#R6: 승인한 출력이 아닌 문서의 저장은 접근이 없어진 문서와 같은 결과로 거절되고 승인 출력은 새 version이 된다", async () => {
  const { world, run } = rig();
  const approved = world.seed(1, ["승인 출력 v1"]);
  const other = world.seed(2, ["다른 문서 v1"]);
  const revoked = world.seed(3, ["접근이 없어질 문서 v1"]);
  world.setOutputs(new Set([approved.id]));
  // 읽은 기준 위에서만 저장한다.
  for (const document of [approved, other, revoked]) {
    const read = await run("document.read_version", {
      reference: {
        document: document.id,
        version: document.versions[0].id,
        section: null,
      },
    });
    assertEquals(read.outcome.kind, "success");
  }
  revoked.locked = true;
  const save = (document: StoredDocument, call: number) =>
    run("document.save_version", {
      document: document.id,
      base_version: document.versions[0].id,
      text: "덮어쓰기",
      media_type: "text/markdown",
    }, id("tcl", call));
  const refused = await save(other, 2);
  const gone = await save(revoked, 3);
  // 승인 출력이 아닌 문서와 접근 없는 문서는 같은 코드·같은 문장이다.
  assertEquals(refused.outcome, { kind: "failure", code: "not_found" });
  assertEquals(refused.outcome, gone.outcome);
  assertEquals(refused.result, gone.result);
  assertEquals(refused.result.summary, "tool target is not available");
  const approvedSave = await save(approved, 4);
  assertEquals(approvedSave.outcome.kind, "success");
  assertEquals(approved.versions.length, 2);
  assertEquals(other.versions.length, 1);
});

Deno.test("lophn-agent/harness/tools#R13: 문서 45개는 20·20·5개로 읽고 중복과 누락이 없으며 조건이 다른 cursor는 거절한다", async () => {
  const { world, run } = rig();
  for (let n = 1; n <= 45; n += 1) world.seed(n, [`본문 ${n}`]);
  const seen: string[] = [];
  let cursor: string | undefined;
  const sizes: number[] = [];
  for (let page = 0; page < 5; page += 1) {
    const outcome = await run("document.list", {
      place: PLACE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    assertEquals(outcome.outcome.kind, "success");
    const documents = contentOf(outcome)["documents"] as {
      document: { id: string };
    }[];
    sizes.push(documents.length);
    seen.push(...documents.map((entry) => entry.document.id));
    const next = outcome.result.continuation;
    if (next === null) {
      assertEquals(outcome.result.complete, true);
      break;
    }
    assertEquals(next.has_more, true);
    assertEquals(outcome.result.complete, false);
    cursor = next.read_next!;
  }
  assertEquals(sizes, [20, 20, 5]);
  assertEquals(new Set(seen).size, 45);
  // 소유 contract에는 항상 20개 이하의 limit으로 묻는다.
  for (const call of world.calls) assertEquals(call.input["limit"], 20);
  // 다른 조건의 목록에서 받은 cursor는 소유 contract에 닿기 전에 거절한다.
  const first = await run("document.list", { place: PLACE });
  const calls = world.calls.length;
  const mixed = await run("document.list", {
    place: { kind: "project", id: id("prj", 2) },
    cursor: first.result.continuation!.read_next!,
  });
  assertEquals(mixed.outcome, { kind: "failure", code: "invalid_input" });
  assertEquals(world.calls.length, calls);
  const forged = await run("document.list", { cursor: "not-a-cursor" });
  assertEquals(forged.outcome.code, "invalid_input");
});

Deno.test("lophn-agent/harness/tools#R13: 소유 contract가 page 하나에 50개를 줘도 이력은 20개씩 보이고 page 경계를 넘어 이어진다", async () => {
  const { world, run } = rig();
  const document = world.seed(
    1,
    Array.from({ length: 120 }, (_, index) => `v${index}`),
  );
  const seen: string[] = [];
  const sizes: number[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const outcome = await run("document.history", {
      document: document.id,
      ...(cursor === undefined ? {} : { cursor }),
    });
    assertEquals(outcome.outcome.kind, "success");
    const versions = contentOf(outcome)["versions"] as { id: string }[];
    sizes.push(versions.length);
    seen.push(...versions.map((version) => version.id));
    if (outcome.result.continuation === null) break;
    cursor = outcome.result.continuation.read_next!;
  }
  // 소유 contract의 page 끝(50번째)에서는 남은 10개만 보이고 다음 page로 넘어간다. 항상 20개 이하다.
  assertEquals(sizes, [20, 20, 10, 20, 20, 10, 20]);
  assertEquals(seen, document.versions.map((version) => version.id));
});

Deno.test("lophn-agent/harness/tools#R14: 긴 본문은 앞부분만 두고 원래 크기·줄 수·생략과 이어 읽을 줄 범위를 표시하며 한글을 깨지 않는다", async () => {
  const { world, run } = rig();
  // 줄 수 상한(300)에 먼저 닿는 본문: 짧은 줄 500개.
  const lines = Array.from({ length: 500 }, (_, index) => `줄 ${index + 1}`);
  const byLines = world.seed(1, [lines.join("\n")]);
  const readLines = await run("document.read_version", {
    reference: {
      document: byLines.id,
      version: byLines.versions[0].id,
      section: null,
    },
  });
  assertEquals(readLines.outcome.kind, "success");
  const text = contentOf(readLines)["text"] as string;
  assertEquals(text.split("\n").length, 300);
  assertEquals(text.startsWith("줄 1\n줄 2"), true);
  assertEquals(readLines.result.complete, false);
  assertEquals(readLines.result.source?.original_lines, 500);
  assertEquals(readLines.result.continuation, {
    has_more: true,
    read_next: "lines 301-500",
  });
  // 바이트 상한(24 KiB)에 먼저 닿는 본문: 한 줄이 긴 한글.
  const wide = world.seed(2, ["가".repeat(8000) + "\n" + "나".repeat(8000)]);
  const readBytes = await run("document.read_version", {
    reference: {
      document: wide.id,
      version: wide.versions[0].id,
      section: null,
    },
  });
  const cut = contentOf(readBytes)["text"] as string;
  assert(new TextEncoder().encode(cut).byteLength <= 24 * 1024);
  assertEquals(cut.includes("�"), false);
  assertEquals(readBytes.result.complete, false);
  assert((readBytes.result.source?.omitted_count ?? 0) > 0);
  // 상한 안의 본문은 그대로이고 완전하다.
  const small = world.seed(3, ["짧은 본문"]);
  const readSmall = await run("document.read_version", {
    reference: {
      document: small.id,
      version: small.versions[0].id,
      section: null,
    },
  });
  assertEquals(contentOf(readSmall)["text"], "짧은 본문");
  assertEquals(readSmall.result.complete, true);
  assertEquals(readSmall.result.continuation, null);
});

Deno.test("lophn-agent/harness/tools#R14: 차이 결과가 상한을 넘으면 항목을 쪼개지 않고 뒤쪽 항목을 덜어 내며 덜어 낸 수를 남긴다", async () => {
  const { world, run } = rig();
  const document = world.seed(1, ["a", "b"]);
  const diff = await run("document.diff", {
    document: document.id,
    before: document.versions[0].id,
    after: document.versions[1].id,
  });
  assertEquals(diff.outcome.kind, "success");
  assertEquals(diff.result.complete, false);
  const content = contentOf(diff);
  const additions = content["additions"] as { text: string }[];
  const omitted = (content["omitted"] as Record<string, number>)["additions"];
  assertEquals(additions.length + omitted, 400);
  assertEquals(additions[0].text.startsWith("추가된 줄 0"), true);
  assert(
    new TextEncoder().encode(JSON.stringify(content)).byteLength <= 24 * 1024,
  );
});

Deno.test("lophn-agent/harness/tools#R3: 숫자 문자열·모르는 필드·본문 상한 초과·공백 본문은 소유 contract에 닿기 전에 거절한다", async () => {
  const { world, run } = rig();
  const document = world.seed(1, ["a"]);
  const cases: [string, unknown][] = [
    ["document.list", { place: PLACE, status: "active", limit: "20" }],
    ["document.list", { limit: 20 }],
    ["document.search", { query: "  " }],
    ["document.read_range", {
      reference: {
        document: document.id,
        version: document.versions[0].id,
        section: null,
      },
      ranges: [{ start_line: "1", end_line: 3 }],
    }],
    ["document.create", {
      title: "제목",
      place: null,
      name: null,
      text: "   ",
      media_type: "text/markdown",
    }],
    ["document.create", {
      title: "제목",
      place: PLACE,
      name: null,
      text: "본문",
      media_type: "text/markdown",
    }],
    ["document.create", {
      title: "제목",
      place: null,
      name: null,
      text: "가".repeat(50_000),
      media_type: "text/markdown",
    }],
    ["document.save_version", {
      document: document.id,
      base_version: document.versions[0].id,
      text: "본문",
      media_type: "application/pdf",
    }],
    ["document.save_version", {
      document: document.id,
      base_version: document.versions[0].id,
      text: "본문",
      media_type: "text/markdown",
      blob_hash: "a".repeat(64),
    }],
  ];
  for (const [tool, input] of cases) {
    const outcome = await run(tool, input);
    assertEquals(outcome.outcome.code, "invalid_input", tool);
    assertEquals(outcome.executed, false, tool);
  }
  assertEquals(world.calls, []);
});

Deno.test("lophn-agent/roles/common#R7: 읽지 않은 기준 version 위에는 저장하지 않고 읽은 뒤 사람이 고친 문서의 저장은 conflict다", async () => {
  const { world, run } = rig();
  const document = world.seed(1, ["처음 본문"]);
  const base = document.versions[0].id;
  const input = {
    document: document.id,
    base_version: base,
    text: "고친 본문",
    media_type: "text/markdown",
  };
  const unread = await run("document.save_version", input, id("tcl", 5));
  assertEquals(unread.outcome, { kind: "failure", code: "invalid_input" });
  assertEquals(
    world.calls.some((call) => call.contract === "SaveToolDocument"),
    false,
  );
  // 읽은 뒤 사람이 같은 문서에 새 판을 저장했다.
  await run("document.read_version", {
    reference: { document: document.id, version: base, section: null },
  });
  document.versions.push({ id: id("ver", 90), text: "사람이 고친 본문" });
  const stale = await run("document.save_version", input, id("tcl", 6));
  assertEquals(stale.outcome, { kind: "failure", code: "conflict" });
  assertEquals(document.versions.length, 2);
  // 최신 판을 읽고 그 위에 저장하면 새 판이 된다.
  const latest = document.versions[1].id;
  await run("document.read_version", {
    reference: { document: document.id, version: latest, section: null },
  });
  const saved = await run("document.save_version", {
    ...input,
    base_version: latest,
  }, id("tcl", 7));
  assertEquals(saved.outcome.kind, "success");
  assertEquals(document.versions.length, 3);
  // 저장 요청은 본문을 글 값으로 싣고 hash·blob 근거를 만들지 않는다.
  const sent = world.calls.filter((call) =>
    call.contract === "SaveToolDocument"
  )
    .at(-1)!;
  assertEquals(sent.input["text"], "고친 본문");
  assertEquals(sent.input["base_version"], latest);
  assertEquals(sent.input["idempotency_key"], id("tcl", 7));
  for (const key of Object.keys(sent.input)) {
    assertEquals(/hash|blob|preparation|files/.test(key), false, key);
  }
  // 역할 정의에 저장 형식 사본이 없다: 기존 문서 저장 입력에는 format 자리가 없다.
  const definition = DOCUMENT_TOOLS.find((tool) =>
    tool.name === "document.save_version"
  )!;
  assertEquals(
    definition.input.safeParse({ ...input, format: { name: "document" } })
      .success,
    false,
  );
});

Deno.test("lophn-agent/harness/tools#R6: 새 문서는 본문과 자리·이름을 글 값으로 싣고 같은 ToolCall의 재전송은 새 문서를 하나만 만든다", async () => {
  const { world, run } = rig();
  const input = {
    title: "기획",
    place: PLACE,
    name: "plan",
    text: "# 기획\n본문",
    media_type: "text/markdown",
  };
  const first = await run("document.create", input, id("tcl", 8));
  assertEquals(first.outcome.kind, "success");
  const again = await run("document.create", input, id("tcl", 8));
  assertEquals(again.outcome.kind, "success");
  assertEquals(contentOf(first)["document"], contentOf(again)["document"]);
  assertEquals(contentOf(first)["version"], contentOf(again)["version"]);
  assertEquals(world.documents.size, 1);
  assertEquals(contentOf(first)["created"], true);
  const sent = world.calls.find((call) =>
    call.contract === "SaveToolDocument"
  )!;
  assertEquals(sent.input["base_version"], null);
  assertEquals(sent.input["metadata"], {
    title: "기획",
    place: PLACE,
    name: "plan",
  });
  // ToolCall ID를 모를 때도 같은 호출은 같은 문서를 가리킨다.
  const unkeyed = rig();
  const a = await unkeyed.run("document.create", input, undefined);
  const b = await unkeyed.run("document.create", input, undefined);
  assertEquals(contentOf(a)["document"], contentOf(b)["document"]);
  assertEquals(unkeyed.world.documents.size, 1);
});

Deno.test("lophn-agent/roles/common#R10: 저장 결과는 접수·version 확정·파일 반영을 다른 사실로 담고 같은 내용은 새 판 없음으로 말한다", async () => {
  const { world, run } = rig();
  const created = await run("document.create", {
    title: "기획",
    place: null,
    name: null,
    text: "본문",
    media_type: "text/markdown",
  }, id("tcl", 10));
  const content = contentOf(created);
  assertEquals(content["accepted"], true);
  assertEquals(content["version_confirmed"], true);
  assertEquals(content["file_reflection"], "not_applicable");
  assertEquals(content["status"], "saved");
  assertEquals(created.result.pending, []);
  assertEquals(created.result.summary, "version saved");
  // 같은 내용을 다시 저장하면 확정된 version은 있어도 새 판은 없다.
  const documentId = content["document"] as string;
  const version = content["version"] as string;
  await run("document.read_version", {
    reference: { document: documentId, version, section: null },
  });
  const same = await run("document.save_version", {
    document: documentId,
    base_version: version,
    text: "본문",
    media_type: "text/markdown",
  }, id("tcl", 11));
  assertEquals(contentOf(same)["status"], "unchanged");
  assertEquals(
    same.result.summary,
    "no new version: the content is the same as the latest",
  );
  assertEquals(world.documents.get(documentId)!.versions.length, 1);
});

Deno.test("lophn-agent/roles/common#R10: 응답이 없으면 완료도 실패도 아닌 불명확이고 확정 전 단계를 남은 단계로 표시한다", async () => {
  const { world, run } = rig();
  world.setUnavailable(true);
  const outcome = await run("document.create", {
    title: "기획",
    place: null,
    name: null,
    text: "본문",
    media_type: "text/markdown",
  }, id("tcl", 12));
  assertEquals(outcome.outcome.kind, "uncertain");
  assertEquals(outcome.result.status, "uncertain");
  assertEquals(outcome.result.pending, ["version_confirmation"]);
  const content = contentOf(outcome);
  assertEquals(content["accepted"], null);
  assertEquals(content["version_confirmed"], false);
  assertEquals(content["idempotency_key"], id("tcl", 12));
  // 같은 요청의 재시도는 같은 key로 가므로 한 번만 만든다.
  world.setUnavailable(false);
  const retry = await run("document.create", {
    title: "기획",
    place: null,
    name: null,
    text: "본문",
    media_type: "text/markdown",
  }, id("tcl", 12));
  assertEquals(retry.outcome.kind, "success");
  assertEquals(world.documents.size, 1);
});

Deno.test("lophn-agent/roles/common#R10: 근거는 이 run이 실제 읽은 고정 참조와 읽지 않은 참조, 모자란 자료를 구분한다", async () => {
  const { world, run } = rig();
  const read = world.seed(1, ["읽은 자료"]);
  const unread = world.seed(2, ["읽지 않은 자료"]);
  await run("document.read_version", {
    reference: {
      document: read.id,
      version: read.versions[0].id,
      section: null,
    },
  });
  const created = await run("document.create", {
    title: "기획",
    place: null,
    name: null,
    text: "근거를 단 본문",
    media_type: "text/markdown",
    evidence: {
      relied_on: [
        { document: read.id, version: read.versions[0].id },
        { document: unread.id, version: unread.versions[0].id },
      ],
      missing: ["지난 분기 수치"],
    },
  }, id("tcl", 13));
  const evidence = contentOf(created)["evidence"] as {
    read: { document: string }[];
    not_read: { document: string }[];
    missing: string[];
    all_read: boolean;
  };
  assertEquals(evidence.read.map((entry) => entry.document), [read.id]);
  assertEquals(evidence.not_read.map((entry) => entry.document), [unread.id]);
  assertEquals(evidence.missing, ["지난 분기 수치"]);
  // 읽었다는 모델의 말이 아니라 읽기 기록이 정한다: 하나라도 모자라면 모두 읽음이 아니다.
  assertEquals(evidence.all_read, false);
  const complete = await run("document.create", {
    title: "기획 둘",
    place: null,
    name: null,
    text: "다른 본문",
    media_type: "text/markdown",
    evidence: {
      relied_on: [{ document: read.id, version: read.versions[0].id }],
      missing: [],
    },
  }, id("tcl", 14));
  assertEquals(
    (contentOf(complete)["evidence"] as { all_read: boolean }).all_read,
    true,
  );
});

Deno.test("lophn-agent/harness/tools#R7: format 안내는 읽기만이고 본문 검사는 글 값을 core에 넘겨 결과만 받으며 판이 늘지 않는다", async () => {
  const { world, run } = rig();
  for (const tool of FORMAT_TOOLS) {
    assertEquals(tool.effect, "read", tool.name);
    assertEquals(tool.confirm, false, tool.name);
  }
  const document = world.seed(1, ["기준 본문"]);
  const before = document.versions.length;
  const listed = await run("format.list", {});
  assertEquals(listed.outcome.kind, "success");
  assertEquals(
    (contentOf(listed)["formats"] as { name: string }[]).map((item) =>
      item.name
    ),
    ["document"],
  );
  // 목록에는 선언 전체(guide·template)가 없다.
  assertEquals(
    "guide" in (contentOf(listed)["formats"] as object[])[0],
    false,
  );
  const rules = await run("format.rules", {
    name: "document",
    module_hash: FORMAT_HASH,
  });
  assertEquals(contentOf(rules)["guide"], "제목 아래 본문을 쓴다");
  const examples = await run("format.examples", {
    name: "document",
    module_hash: FORMAT_HASH,
  });
  assertEquals(contentOf(examples)["examples"], ["# 제목", "## 절"]);
  const passed = await run("format.validate", {
    format: { name: "document", module_hash: FORMAT_HASH },
    text: "# 제목\n본문",
    media_type: "text/markdown",
  });
  assertEquals(contentOf(passed)["status"], "passed");
  assertEquals(passed.result.summary, "format check passed");
  const failed = await run("format.validate", {
    format: { name: "document", module_hash: FORMAT_HASH },
    text: "깨짐",
    media_type: "text/markdown",
  });
  assertEquals(contentOf(failed)["status"], "failed");
  assertEquals(contentOf(failed)["error_count"], 1);
  // 검사 요청은 본문을 글 값으로 싣고 저장 contract를 부르지 않으며 판이 늘지 않는다.
  const validations = world.calls.filter((call) =>
    call.contract === "ValidateToolText"
  );
  assertEquals(validations.length, 2);
  assertEquals(validations[0].input["text"], "# 제목\n본문");
  assertEquals(
    world.calls.some((call) => call.contract === "SaveToolDocument"),
    false,
  );
  assertEquals(document.versions.length, before);
  assertEquals(world.documents.size, 1);
  // 검사 입력에는 hash·blob 자리가 없다.
  for (const key of Object.keys(validations[0].input)) {
    assertEquals(/hash|blob|preparation|files/.test(key), false, key);
  }
});

Deno.test("lophn-agent/harness/tools#R7: format tool은 저장·설치 동작을 정의에 갖지 않고 SDK 안내는 sdk 묶음이 읽기로만 한다", () => {
  for (const tool of FORMAT_TOOLS) {
    assertEquals(tool.name.startsWith("format."), true);
    assertEquals(tool.contract === "SaveToolDocument", false);
  }
});

// preset 저장 검사(presets#R7, R11)가 쓰는 묶음 판이다. 묶음은 이름 목록일 뿐이어서 역할 상한이 따로 적용된다.
const VALIDATE: ValidateDeps = {
  bundles: TOOL_BUNDLES,
  mcpServers: new Map(),
  roleCaps: ROLE_CAPS,
  definitionKey: () => undefined,
  catalogEntry: () => undefined,
  modelListed: () => null,
  credentialKeys: () => [],
};

function selecting(
  kind: "lophn" | "context_engineer",
  bundles: string[],
  tools: string[] = [],
) {
  return {
    ...productPresetDefinition(kind, "a".repeat(64)),
    capability: {
      bundles: bundles.map((name) => ({ name, revision: 1 })),
      tools: tools.map((tool) => ({ tool, app_command: null })),
    },
  };
}

Deno.test("lophn-agent/harness/tools#R6: 묶음 이름은 개별 동작으로 펼쳐 고정되고 쓰기 묶음은 읽기 묶음과 따로 고른다", () => {
  assertEquals([...TOOL_BUNDLES.keys()].sort(), [
    "app-read",
    "context-read",
    "context-write",
    "document-read",
    "document-write",
    "format",
    "lophn-guide",
    "metadata-read",
    "problem-read",
    "sdk",
    "ticket-read",
    "ticket-write",
    "visual",
  ]);
  assertEquals(TOOL_BUNDLES.get("document-read"), DOCUMENT_READ_TOOL_NAMES);
  assertEquals(TOOL_BUNDLES.get("document-write"), DOCUMENT_WRITE_TOOL_NAMES);
  assertEquals(TOOL_BUNDLES.get("format"), FORMAT_TOOL_NAMES);
  // 어느 묶음의 이름도 정의가 있고 읽기 묶음에는 쓰기 동작이 없다.
  const defined = new Map(BUILTIN_TOOLS.map((tool) => [tool.name, tool]));
  for (const names of TOOL_BUNDLES.values()) {
    for (const name of names) assert(defined.has(name), name);
  }
  for (const name of TOOL_BUNDLES.get("document-read")!) {
    assertEquals(defined.get(name)!.effect, "read", name);
  }
  // 읽기·format 묶음을 고른 preset은 저장되고 쓰기 동작은 들어가지 않는다.
  const reading = validateDefinition(
    selecting("lophn", ["document-read", "format"]),
    VALIDATE,
  );
  assert(reading.ok, JSON.stringify(reading));
  // 모르는 묶음 이름은 저장 전체의 not_found다(묶음 이름 추측 없음).
  const unknown = validateDefinition(
    selecting("lophn", ["document"]),
    VALIDATE,
  );
  assertEquals(unknown.ok, false);
  assertEquals(!unknown.ok && unknown.error.code, "not_found");
  // 역할 상한은 묶음 뒤에도 적용된다: Operator 상한에는 새 문서 tool이 없어 쓰기 묶음 전체가
  // 거절되고, 같은 묶음이 상한 안인 역할에서는 저장된다.
  const writing = validateDefinition(
    selecting("lophn", ["document-write"]),
    VALIDATE,
  );
  assert(writing.ok, JSON.stringify(writing));
  const operator = validateDefinition(
    { ...selecting("lophn", ["document-write"]), kind: "operator" },
    VALIDATE,
  );
  assertEquals(operator.ok, false);
  assertEquals(!operator.ok && operator.error.code, "forbidden");
  const operatorSaving = validateDefinition(
    {
      ...selecting("lophn", [], ["document.save_version"]),
      kind: "operator",
    },
    VALIDATE,
  );
  assert(operatorSaving.ok, JSON.stringify(operatorSaving));
});

Deno.test("lophn-agent/harness/tools#R12: 범위 밖 문서의 읽기 실패는 없는 문서와 같은 결과이고 원문 오류를 싣지 않는다", async () => {
  const { world, run } = rig();
  const hidden = world.seed(1, ["숨은 본문"], { locked: true });
  const lockedRead = await run("document.history", { document: hidden.id });
  const absentRead = await run("document.history", { document: id("doc", 60) });
  assertEquals(lockedRead.outcome, absentRead.outcome);
  assertEquals(lockedRead.result, absentRead.result);
  assertEquals(JSON.stringify(lockedRead.result).includes(hidden.id), false);
  assertEquals(lockedRead.result.summary, "tool target is not available");
  // 소유 contract 권한이 없으면 handler에 닿지 않고 없는 tool과 같다.
  const handlers = createDocumentToolHandlers(world);
  const noScope = await executeTool(
    {
      listed: rig().listed,
      handlers,
      credential: { run: RUN, targets: new Set(), operations: new Set() },
    },
    "document.list",
    {},
  );
  assertEquals(noScope.outcome.code, "not_found");
  const formats = createFormatToolHandlers(world);
  assertEquals(formats.size, 4);
});

Deno.test("lophn-agent/harness/tools#R6: run 자격의 operation은 제공 목록의 소유 contract와 저장 보조 operation의 합이고 쓰기 tool이 없으면 저장 operation이 없다", () => {
  const byName = (names: readonly string[]) =>
    BUILTIN_TOOLS.filter((tool) => names.includes(tool.name));
  const reading = runOperations(byName(DOCUMENT_READ_TOOL_NAMES));
  assertEquals(reading.includes("document.save"), false);
  assertEquals(reading.includes("document.prepare"), false);
  assertEquals(reading.includes("SaveToolDocument"), false);
  assert(reading.includes("document.read"));
  const writing = runOperations(byName(["document.save_version"]));
  assertEquals(writing, [
    "SaveToolDocument",
    "document.prepare",
    "document.save",
  ]);
  // 이동·이름 변경·보관 같은 직접 관리 operation은 어느 목록에서도 나오지 않는다.
  const all = runOperations(BUILTIN_TOOLS);
  for (
    const operation of [
      "document.move",
      "document.rename",
      "document.archive",
      "document.unarchive",
      "document.restore",
      "document.upload",
      "document.update",
    ]
  ) {
    assertEquals(all.includes(operation), false, operation);
  }
});
