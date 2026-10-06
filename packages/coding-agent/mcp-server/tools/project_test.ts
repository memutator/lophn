// lophn_project tool 테스트다(mcp#R9, cli#R22). 읽기 route만 부르고 절대 경로·폴더·
// tracking 규칙·폴더별 문서 수를 어떤 응답에서도 내지 않는다. 현재 위치 불일치는 오류가
// 아닌 빈 목록과 사람 등록 안내다. 등록·변경 op는 없다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { resolveRoute } from "../registry.ts";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { createProjectTool } from "./project.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

function run(
  flow: ReturnType<typeof scriptedFlow>,
  input: Record<string, unknown>,
) {
  const resolved = resolveRoute("lophn_project", input.op as string);
  assert(resolved);
  return createProjectTool({ client: flow.client })(
    "lophn_project",
    resolved.route,
    input,
  );
}

// 사람용 투영이 잘못 새어 와도 이 tool이 걸러야 하는 필드를 일부러 섞는다.
const LEAKY = {
  id: PROJECT,
  name: "mahas",
  title: "Notes",
  purpose: "작업 기록",
  revision: "3",
  status: "active",
  folders: [{ path: "/home/me/secret-folder", description: "비공개" }],
  tracking: { enabled: true, patterns: [], use_gitignore: true },
  initial_tracking_proposal: { enabled: true, patterns: [] },
  document_count: 99,
  documents: [{ document: DOC, version: "ver_x", section: null }],
};
const ROOT = {
  entries: [{ kind: "project", id: PROJECT, document_count: 2 }],
  next_cursor: null,
};

Deno.test("coding-agent/mcp-server#R9: show는 허용한 필드만 내고 경로·폴더·tracking·폴더별 수를 걸러 낸다", async () => {
  const flow = scriptedFlow({
    "project.get": { project: LEAKY, as_of_seq: "4", next_cursor: null },
    "outline.root": ROOT,
  });
  const result = await run(flow, { op: "show", project: PROJECT });
  const text = JSON.stringify(result);
  for (
    const banned of [
      "secret-folder",
      "비공개",
      "folders",
      "tracking",
      "initial_tracking_proposal",
    ]
  ) assertEquals(text.includes(banned), false, banned);
  const project = (result.data as { project: Record<string, unknown> })
    .project;
  // 문서 수는 응답이 낸 99가 아니라 목차가 센 읽을 수 있는 문서 수다.
  assertEquals(project.document_count, 2);
  assertEquals(project.reading, [{
    document: DOC,
    version: "ver_x",
    section: null,
  }]);
  assertEquals(result.isError, undefined);
});

Deno.test("coding-agent/mcp-server#R9: list는 project마다 같은 투영을 내고 이어 읽기를 밝히며 목차를 못 읽으면 문서 수를 모른다고 한다", async () => {
  const flow = scriptedFlow({
    "project.list": {
      projects: [LEAKY],
      as_of_seq: "4",
      next_cursor: "cur",
      omitted: [{ reason: "page_limit", count: 3 }],
    },
    "outline.root": () => fail("forbidden", "no"),
  });
  const result = await run(flow, { op: "list" });
  assert(result.summary.includes("이어 읽을 것이 더 있다"), result.summary);
  assert(result.summary.includes("3개 생략"), result.summary);
  const data = result.data as {
    projects: { document_count: number | null }[];
    next_cursor: string;
  };
  assertEquals(data.projects[0].document_count, null);
  assertEquals(data.next_cursor, "cur");
  assertEquals(JSON.stringify(result).includes("secret-folder"), false);
});

Deno.test("coding-agent/mcp-server#R9: current는 입력 없이 project 참조 하나를 내고 불일치는 오류가 아닌 빈 목록과 등록 안내다", async () => {
  const found = scriptedFlow({
    "project.resolve_cwd": { project: PROJECT, as_of_seq: "4" },
  });
  const ok = await run(found, { op: "current" });
  assertEquals((ok.data as { projects: unknown[] }).projects, [{
    project: PROJECT,
  }]);
  // route에는 빈 입력만 간다. caller 경로는 없다.
  assertEquals(found.calls("project.resolve_cwd")[0].input, {});

  const none = scriptedFlow({
    "project.resolve_cwd": () => fail("not_found", "project not found"),
  });
  const empty = await run(none, { op: "current" });
  assertEquals(empty.isError, undefined);
  assertEquals((empty.data as { projects: unknown[] }).projects, []);
  assert(empty.summary.includes("속하지 않는다"), empty.summary);
  assert(
    empty.next.some((line) => line.includes("화면에서 사람이 한다")),
    empty.next.join("|"),
  );
});

Deno.test("coding-agent/mcp-server#R9: 다른 오류는 isError로 이유가 그대로 오고 등록 op는 표에 없다", async () => {
  const flow = scriptedFlow({
    "project.get": () => fail("not_found", "project not found"),
  });
  const missing = await run(flow, { op: "show", project: PROJECT });
  assertEquals(missing.isError, true);
  assertEquals(missing.summary, "project not found");
  // 등록·보관 같은 op는 resolveRoute가 거절하고 tool도 실행하지 않는다.
  assertEquals(resolveRoute("lophn_project", "register"), undefined);
  const ghost = await createProjectTool({ client: flow.client })(
    "lophn_project",
    resolveRoute("lophn_project", "list")!.route,
    { op: "register" },
  );
  assertEquals(ghost.isError, true);
  assertEquals(flow.sent.length, 1);
});
