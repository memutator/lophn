import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../ipc/core.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { coreWorkspaceSource, relativeToFolders } from "./core-source.ts";

const PROJECT = "prj_01k6p0000000000000000000aa";
const DOC_A = "doc_01k6p0000000000000000000aa";
const DOC_B = "doc_01k6p0000000000000000000bb";

function routedCore(
  routes: Record<string, (body: Record<string, unknown>) => CoreReply>,
): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        const route = routes[`${input.resource}/${input.method}`];
        return Promise.resolve(
          route
            ? route(input.body as Record<string, unknown>)
            : { ok: false, error: { code: "not_found", message: "" } },
        );
      },
    },
  };
}

const routes = {
  "projects/get": () => ({
    ok: true,
    value: {
      project: {
        id: PROJECT,
        title: "Plans",
        folders: [{ path: "/work/plans", description: "" }],
      },
    },
  }),
  "documents/list": () => ({
    ok: true,
    value: {
      documents: [
        { document: { id: DOC_A, title: "Goals" } },
        { document: { id: DOC_B, title: "Week one" } },
      ],
      next_cursor: null,
    },
  }),
  "contexts/list": () => ({
    ok: true,
    value: {
      contexts: [
        {
          id: "ctx_01k6p0000000000000000000aa",
          title: "Planning",
          items: [{ target: { kind: "document", document: DOC_A } }],
        },
        {
          id: "ctx_01k6p0000000000000000000bb",
          title: "Elsewhere",
          items: [{ target: { kind: "app_command", app: "app_x" } }],
        },
      ],
      next_cursor: null,
    },
  }),
};

Deno.test("shell/desktop#R28: 작업대는 projects.get·documents.list와 그 문서를 담은 컨텍스트로 연다", async () => {
  const { core, calls } = routedCore(routes);
  const source = coreWorkspaceSource(core);
  assertEquals(await source.project(PROJECT), {
    ok: true,
    value: { id: PROJECT, title: "Plans", folders: [{ path: "/work/plans" }] },
  });
  assertEquals(await source.documents(PROJECT), {
    ok: true,
    value: [{ id: DOC_A, title: "Goals" }, { id: DOC_B, title: "Week one" }],
  });
  assertEquals(
    calls.find((call) => call.resource === "documents")?.body,
    { place: { kind: "project", id: PROJECT }, status: "active" },
  );
  assertEquals(await source.contexts(PROJECT), {
    ok: true,
    value: [{ id: "ctx_01k6p0000000000000000000aa", title: "Planning" }],
  });
  // 이 단위 테스트에는 layout bridge(lophnLayout)가 없다. 통로가 없으면 읽지 못함으로 답한다.
  assertEquals((await source.readLayout(PROJECT)).ok, false);
});

Deno.test("shell/desktop#R30: 팔레트 파일 묶음은 files.list의 원본 파일 중 문서로 잡힌 것만 상대 경로로 보인다", async () => {
  const { core } = routedCore({
    ...routes,
    "files/list": () => ({
      ok: true,
      value: {
        targets: [
          {
            kind: "project_file",
            project: PROJECT,
            path: "/work/plans/goals.md",
          },
          {
            kind: "project_file",
            project: PROJECT,
            path: "/work/plans/raw.txt",
          },
          { kind: "working_copy", document: DOC_B },
        ],
        next_cursor: null,
      },
    }),
    "documents/get": (body) => ({
      ok: true,
      value: {
        document: {
          id: body.document,
          title: body.document === DOC_A ? "Goals" : "Week one",
          file_source: body.document === DOC_A
            ? {
              kind: "project_file",
              project: PROJECT,
              path: "/work/plans/goals.md",
            }
            : null,
        },
      },
    }),
  });
  assertEquals(await coreWorkspaceSource(core).files(PROJECT), {
    ok: true,
    value: [{
      folder: "/work/plans",
      path: "goals.md",
      document: DOC_A,
      title: "Goals",
    }],
  });
});

Deno.test("shell/desktop#R30: files.list를 읽지 못하면 파일 묶음만 실패하고 문서마다 읽지 않는다", async () => {
  const { core, calls } = routedCore(routes);
  const files = await coreWorkspaceSource(core).files(PROJECT);
  assertEquals(files, { ok: false, message: "not_found" });
  assertEquals(calls.filter((call) => call.method === "get").length, 0);
});

Deno.test("documents/projects#R10: 상대 경로는 가장 깊은 등록 폴더를 기준으로 한다", () => {
  const folders = [{ path: "/work" }, { path: "/work/plans/" }];
  assertEquals(relativeToFolders("/work/plans/a.md", folders), "a.md");
  assertEquals(relativeToFolders("/work/b.md", folders), "b.md");
  assertEquals(relativeToFolders("/elsewhere/c.md", folders), null);
  assertEquals(relativeToFolders("/workshop/d.md", folders), null);
});
