import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreCaller } from "./app-connection.ts";
import { createAppProjects } from "./app-projects.ts";

function row(id: string, status: string) {
  return {
    id,
    name: id,
    title: `Title ${id}`,
    purpose: "",
    revision: 1,
    status,
    folders: [{ path: `/home/me/${id}`, description: "", found: true }],
  };
}

test("앱 화면은 모든 page의 project를 받고 폴더 path는 받지 않는다", async () => {
  const pages: Record<string, unknown> = {
    first: { projects: [row("prj_a", "active")], next_cursor: "c2" },
    c2: { projects: [row("prj_b", "archived")], next_cursor: null },
  };
  const call: CoreCaller = async (_kind, _resource, _method, body) => {
    const cursor = (body as { cursor?: string }).cursor ?? "first";
    return { ok: true, value: pages[cursor] } as Awaited<
      ReturnType<CoreCaller>
    >;
  };
  const listed = await createAppProjects({ call }).list();
  assert.ok(listed.ok);
  assert.deepEqual(listed.value.projects, [
    {
      id: "prj_a",
      name: "prj_a",
      title: "Title prj_a",
      purpose: "",
      status: "active",
    },
    {
      id: "prj_b",
      name: "prj_b",
      title: "Title prj_b",
      purpose: "",
      status: "archived",
    },
  ]);
  assert.ok(!JSON.stringify(listed.value).includes("/home/me"));
});
