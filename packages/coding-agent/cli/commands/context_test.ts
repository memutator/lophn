// context command 테스트다(cli#R18, R19). 읽기 다섯과 propose뿐이고 생성·항목 변경
// command가 표에 없는지, 폴더·untracked 파일 항목을 거절하는지, propose가 변경안 문서만
// 저장하고 MCP와 같은 결과를 내는지 본다. core 대신 route별 답을 정한 흐름 client를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import {
  describeContextProposal,
  proposeContextChange,
} from "../../connection/mod.ts";
import {
  preparedFor,
  savedResult,
  scriptedFlow,
} from "../../connection/testing/mod.ts";
import { COMMANDS, findCommand } from "../registry.ts";
import { CONTEXT_COMMANDS, runContextPropose } from "./context.ts";

const CONTEXT = "ctx_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

function propose(input: Record<string, unknown>) {
  const entry = findCommand("context propose");
  assert(entry);
  return entry.input.safeParse({ command: "context propose", ...input });
}

const rename = { kind: "rename", context: CONTEXT, title: "새 이름" };

Deno.test("coding-agent/cli#R18: context command는 읽기 다섯과 propose뿐이고 생성·항목 추가와 제거·보관 command가 없다", () => {
  assertEquals(CONTEXT_COMMANDS.map((entry) => entry.name), [
    "context list",
    "context show",
    "context items",
    "context glossary",
    "context of",
    "context propose",
  ]);
  const names = COMMANDS.map((entry) => entry.name).filter((name) =>
    name.startsWith("context ")
  );
  assertEquals(names.length, 6);
  for (
    const forbidden of [
      "context create",
      "context add",
      "context remove",
      "context set-item",
      "context rename",
      "context archive",
      "context apply",
      "term define",
    ]
  ) {
    assertEquals(findCommand(forbidden), undefined, forbidden);
  }
});

Deno.test("coding-agent/cli#R18: 읽기 command는 보관 포함 목록과 관점별 항목을 소유 route로 읽는다", () => {
  const list = findCommand("context list");
  assert(list);
  assert(
    list.input.safeParse({ command: "context list", status: "all" }).success,
  );
  assertEquals(list.monoRoute?.name, "context.list");
  const items = findCommand("context items");
  assert(items);
  assert(
    items.input.safeParse({
      command: "context items",
      context: CONTEXT,
      perspective: "reference",
    }).success,
  );
  assert(
    !items.input.safeParse({
      command: "context items",
      context: CONTEXT,
      perspective: "belongs_to",
    }).success,
  );
  assertEquals(items.monoRoute?.name, "outline.context");
  assertEquals(findCommand("context glossary")?.monoRoute?.name, "term.list");
  assertEquals(findCommand("context of")?.monoRoute?.name, "context.related");
  assertEquals(findCommand("context show")?.monoRoute?.name, "context.get");
});

Deno.test("coding-agent/cli#R18: 폴더나 untracked 파일 항목 제안은 입력 검사에서 거절한다", () => {
  const itemWith = (target: unknown) => ({
    change: {
      kind: "set_item",
      context: CONTEXT,
      item: { target, perspective: "basis", reason: "읽는다" },
    },
    reason: "기준으로 넣는다",
  });
  assert(
    propose(itemWith({ kind: "document", document: DOC, section: null }))
      .success,
  );
  for (
    const target of [
      { kind: "folder", path: "/home/me/project" },
      { kind: "untracked_file", path: "notes/new.md" },
      { kind: "document", document: "notes/new.md", section: null },
    ]
  ) {
    assert(!propose(itemWith(target)).success, JSON.stringify(target));
  }
});

Deno.test("coding-agent/cli#R19: propose는 대상 읽기와 변경안 문서 준비·저장만 부르고 context·용어 route를 갖지 않는다", () => {
  const entry = findCommand("context propose");
  assert(entry);
  assertEquals(
    Object.values(entry.opRoutes ?? {}).map((route) => route.name),
    ["context.get", "document.prepare", "document.save"],
  );
  assertEquals(entry.monoRoute, undefined);
  // 이유 없는 변경안과 분할·병합은 입력 검사에서 거절한다.
  assert(propose({ change: rename, reason: "더 정확하다" }).success);
  assert(!propose({ change: rename }).success);
  assert(!propose({ change: rename, reason: " " }).success);
  for (const kind of ["split", "merge", "archive"]) {
    assert(
      !propose({ change: { kind, context: CONTEXT }, reason: "r" }).success,
      kind,
    );
  }
});

Deno.test("coding-agent/cli#R19: propose는 변경안 문서만 저장하고 MCP와 같은 결과를 낸다", async () => {
  const handlers = {
    "context.get": {
      complete: true,
      as_of_seq: "9",
      next_cursor: null,
      context: {
        id: CONTEXT,
        title: "판단 묶음",
        purpose: "p",
        items: [],
        revision: "4",
        status: "active",
      },
    },
    "document.prepare": preparedFor,
    "document.save": (input: unknown) =>
      savedResult("saved", (input as { document: string }).document),
  };
  const bodies: string[] = [];
  const prepareBytes = async (
    file: Parameters<
      Parameters<typeof proposeContextChange>[0]["prepareBytes"]
    >[0],
  ) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of file.open()) chunks.push(chunk);
    bodies.push(new TextDecoder().decode(chunks[0]));
    return ok({
      preparation: "prep",
      principal: "cac",
      purpose: "document_file",
      hash: file.blob_hash,
      size_bytes: file.bytes,
    });
  };
  const viaCli = scriptedFlow(handlers);
  const cli = await runContextPropose(
    {
      change: rename,
      reason: "이름이 더 정확하다",
      idempotency_key: "propose-1",
    },
    { client: viaCli.client, prepareBytes },
  );
  assert(cli.ok, cli.ok ? "" : cli.error.message);
  // 변경안 문서의 prepare·save 외에 command를 보내지 않았다.
  assertEquals(
    viaCli.sent.filter((call) => call.kind === "command").map((call) =>
      call.name
    ),
    ["document.save"],
  );
  assertEquals(bodies[0].includes("이름이 더 정확하다"), true);
  assertEquals(
    (cli.value.data as { applied: boolean }).applied,
    false,
  );
  // MCP 통로와 같은 입구라 같은 결과 모양이다.
  const viaMcp = scriptedFlow(handlers);
  const mcp = await proposeContextChange(
    { client: viaMcp.client, prepareBytes },
    {
      change: rename,
      reason: "이름이 더 정확하다",
      idempotency_key: "propose-1",
    },
  );
  assert(mcp.ok);
  assertEquals(cli.value, describeContextProposal(mcp.value));
  assertEquals(cli.value.next[0].includes("Context Engineer"), true);
});
