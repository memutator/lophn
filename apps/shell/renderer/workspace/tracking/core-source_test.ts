// preview_tracking worker route는 아직 제품 core가 서빙하지 않는다(documents#T12). 그래서 이
// 테스트는 contract 모양(입력·page·set_tracking 근거)을 가짜 core 통로로 확인한다.
import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreTrackingSource } from "./core-source.ts";

const PROJECT = "prj_01k6p0000000000000000000aa";
const OTHER = "prj_01k6p0000000000000000000bb";

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

const proposal = {
  enabled: true,
  patterns: [{ effect: "include" as const, glob: "**/*.md" }],
  use_gitignore: true,
};

const projectValue = {
  id: PROJECT,
  name: "plans",
  title: "Plans",
  purpose: "",
  revision: "4",
  status: "active",
  folders: [{ path: "/work/plans", description: "notes" }],
  tracking: { enabled: false, patterns: [], use_gitignore: false },
  document_count: 0,
  documents: [],
  initial_tracking_proposal: proposal,
};

function page(
  entries: { path: string; included: boolean; reason: string }[],
  next: string | null,
) {
  return {
    project: PROJECT,
    base_revision: "4",
    folders: [{ path: "/work/plans", description: "notes" }],
    tracking: proposal,
    observed_at: "2026-10-06T09:00:00.000Z",
    entries: entries.map((entry) => ({ folder_path: "/work/plans", ...entry })),
    complete: next === null,
    next_cursor: next,
  };
}

Deno.test("documents/projects#R3, R8: projects.get에서 현재 규칙·판과 처음 제안을 읽는다", async () => {
  const { core, calls } = fakeCore([{
    ok: true,
    value: { project: projectValue },
  }]);
  const read = await coreTrackingSource(core).project(PROJECT);
  assertEquals(calls[0], {
    kind: "read",
    resource: "projects",
    method: "get",
    body: { project: PROJECT },
  });
  assertEquals(read, {
    ok: true,
    value: {
      id: PROJECT,
      title: "Plans",
      revision: "4",
      folders: [{ path: "/work/plans", description: "notes" }],
      tracking: { enabled: false, patterns: [], useGitignore: false },
      proposal: {
        enabled: true,
        patterns: [{ effect: "include", glob: "**/*.md" }],
        useGitignore: true,
      },
    },
  });
});

Deno.test("documents/projects#R6: 미리보기는 끝 page까지 모으고 켜기는 미리 본 구성과 마지막 page를 근거로 보낸다", async () => {
  const last = page(
    [{ path: "b.png", included: false, reason: "unmatched" }],
    null,
  );
  const { core, calls } = fakeCore([
    { ok: true, value: { project: projectValue } },
    {
      ok: true,
      value: page(
        [{ path: "a.md", included: true, reason: "include **/*.md" }],
        "p2",
      ),
    },
    { ok: true, value: last },
    { ok: true, value: { ...projectValue, revision: "5", tracking: proposal } },
  ]);
  const source = coreTrackingSource(core);
  const read = await source.project(PROJECT);
  if (!read.ok) throw new Error("project read failed");
  const rules = read.value.proposal;
  const preview = await source.preview(read.value, rules);
  if (!preview.ok) throw new Error("preview failed");
  assertEquals(preview.value.entries.map((entry) => entry.path), [
    "a.md",
    "b.png",
  ]);
  assertEquals(preview.value.basis, last);
  assertEquals(calls[1], {
    kind: "worker",
    resource: "projects",
    method: "preview_tracking",
    body: {
      project: PROJECT,
      base_revision: "4",
      folders: [{ path: "/work/plans", description: "notes" }],
      tracking: proposal,
    },
  });
  assertEquals((calls[2]!.body as { cursor: string }).cursor, "p2");

  const applied = await source.apply(read.value, preview.value);
  const body = calls[3]!.body as {
    input: unknown;
    compare: unknown;
    idempotency_key: string;
  };
  assertEquals(calls[3]!.kind, "command");
  assertEquals(calls[3]!.method, "set_tracking");
  assertEquals(body.input, {
    project: PROJECT,
    folders: [{ path: "/work/plans", description: "notes" }],
    tracking: proposal,
    preview: last,
  });
  assertEquals(body.compare, { base_revision: "4" });
  assertEquals(applied.ok && applied.value.tracking.enabled, true);
});

Deno.test("documents/projects#R7: 겹침 검사는 다른 활성 프로젝트의 켜진 폴더만 모은다", async () => {
  const { core } = fakeCore([{
    ok: true,
    value: {
      projects: [
        projectValue,
        {
          ...projectValue,
          id: OTHER,
          title: "Wiki",
          tracking: proposal,
          folders: [{ path: "/work", description: "" }],
        },
        {
          ...projectValue,
          id: "prj_01k6p0000000000000000000cc",
          title: "Off",
          folders: [{ path: "/elsewhere", description: "" }],
        },
      ],
      next_cursor: null,
    },
  }]);
  assertEquals(await coreTrackingSource(core).trackedRoots(PROJECT), {
    ok: true,
    value: [{ project: OTHER, title: "Wiki", path: "/work" }],
  });
});

Deno.test("shell/wording#R10: 미리보기·켜기 실패는 code만 넘겨 화면이 대상·다음 행동을 고르게 한다", async () => {
  const { core } = fakeCore([
    {
      ok: false,
      error: { code: "unavailable", message: "EACCES /work/plans" },
    },
  ]);
  const source = coreTrackingSource(core);
  const project = {
    id: PROJECT,
    title: "Plans",
    revision: "4",
    folders: [],
    tracking: { enabled: false, patterns: [], useGitignore: false },
    proposal: { enabled: true, patterns: [], useGitignore: true },
  };
  assertEquals(await source.preview(project, project.proposal), {
    ok: false,
    code: "unavailable",
  });
});
