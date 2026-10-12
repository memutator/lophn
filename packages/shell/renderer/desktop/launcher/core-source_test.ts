import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type { CoreSource } from "../connection/connection.ts";
import { coreLauncherSource } from "./core-source.ts";

const PROJECT = "prj_01k6p0000000000000000000aa";

function fakeCore(
  replies: CoreReply[],
): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        return Promise.resolve(
          replies.shift() ??
            { ok: false, error: { code: "internal", message: "" } },
        );
      },
    },
  };
}

const value = {
  id: PROJECT,
  name: "plans",
  title: "Plans",
  purpose: "Plan the quarter.",
  revision: "3",
  status: "active",
  folders: [{ path: "/work/plans", description: "notes" }],
  tracking: { enabled: false, patterns: [], use_gitignore: false },
  document_count: 2,
  documents: [],
  initial_tracking_proposal: {
    enabled: true,
    patterns: [{ effect: "include", glob: "**/*.md" }],
    use_gitignore: true,
  },
};

Deno.test("documents/projects#R1, R3: 등록은 projects.create command로 추적 꺼짐을 보내고 route output을 그대로 읽는다", async () => {
  const { core, calls } = fakeCore([{ ok: true, value }]);
  const source = coreLauncherSource(core, undefined);
  const result = await source.register({
    id: PROJECT,
    name: "plans",
    title: "Plans",
    purpose: "Plan the quarter.",
    folders: [{ path: "/work/plans", description: "notes" }],
  });
  assertEquals(calls, [{
    kind: "command",
    resource: "projects",
    method: "create",
    body: {
      input: {
        id: PROJECT,
        name: "plans",
        title: "Plans",
        purpose: "Plan the quarter.",
        folders: [{ path: "/work/plans", description: "notes" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: `projects-create-${PROJECT}`,
      compare: {},
      prepared: [],
    },
  }]);
  assertEquals(result, {
    ok: true,
    value: {
      id: PROJECT,
      name: "plans",
      title: "Plans",
      purpose: "Plan the quarter.",
      folders: [{ path: "/work/plans" }],
      tracking: { enabled: false, patterns: [], useGitignore: false },
      documentCount: 2,
    },
  });
});

Deno.test("documents/projects#R8: 카드는 보관하지 않은 프로젝트를 page 끝까지 읽고 실패는 code만 넘긴다", async () => {
  const { core, calls } = fakeCore([
    { ok: true, value: { projects: [value], next_cursor: "c1" } },
    { ok: true, value: { projects: [], next_cursor: null } },
    { ok: false, error: { code: "unavailable", message: "down" } },
  ]);
  const source = coreLauncherSource(core, undefined);
  const first = await source.projects();
  assertEquals(first.ok && first.value.map((card) => card.title), ["Plans"]);
  assertEquals(calls.map((call) => call.body), [
    { status: "active" },
    { status: "active", cursor: "c1" },
  ]);
  assertEquals(await source.projects(), { ok: false, code: "unavailable" });
});

Deno.test("documents/projects#R1: 폴더는 preload 선택기로만 고르고 통로가 없거나 실패하면 고르지 못함이다", async () => {
  const { core } = fakeCore([]);
  assertEquals(await coreLauncherSource(core, undefined).pickFolder(), {
    ok: false,
  });
  const picked = coreLauncherSource(core, {
    pick: () => Promise.resolve({ ok: true, path: "/work/plans" }),
  });
  assertEquals(await picked.pickFolder(), { ok: true, path: "/work/plans" });
  const refused = coreLauncherSource(core, {
    pick: () => Promise.resolve({ ok: false, code: "forbidden" }),
  });
  assertEquals(await refused.pickFolder(), { ok: false });
});
