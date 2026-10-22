import { assertEquals } from "@std/assert";
import {
  type PlaceFacts,
  placeScope,
  runtimeFolders,
} from "./place-folders.ts";

const domain = (id: string) => ({
  id,
  folder: `/data/domains/${id}`,
  artifactsFolder: `/data/domains/${id}/artifacts`,
});
const base: PlaceFacts = {
  role: "operator",
  place: null,
  projectFolders: ["/p1", "/p2"],
  appSource: "/app",
  domains: [domain("dom_a"), domain("dom_b")],
  dataFolder: "/data/projects/prj_a",
  allProjectFolders: ["/p1", "/p2", "/q"],
  workflowsFolder: "/data/projects/prj_a/workflows",
};
const workflows = "/data/projects/prj_a/workflows";
const project = { kind: "project", id: "prj_a" } as const;
const app = { kind: "app", id: "app_a" } as const;

// 이 규칙이 넓어지면 Operator·App Engineer·lophn이 project의 workflows/를 쓴다. 쓰는 것은 그 project의 PM뿐이다.
// 이 규칙이 넓어지면 PM이 앱 source를, App Engineer가 사람의 project 폴더를, 둘이 남의 domain이나 앱 data·agent 정의를 쓴다.
Deno.test("PM에는 앱 source가 없고 App Engineer에는 project 폴더가 없으며 둘 다 facts의 domain 폴더만 연다", () => {
  const pm = placeScope({ ...base, role: "project_manager", place: project });
  assertEquals(pm, {
    read: [
      "/p1",
      "/p2",
      "/data/domains/dom_a",
      "/data/domains/dom_b",
      workflows,
    ],
    write: [
      "/p1",
      "/p2",
      "/data/domains/dom_a",
      "/data/domains/dom_b",
      workflows,
    ],
    base: "/p1",
  });
  const engineer = placeScope({ ...base, role: "app_engineer", place: app });
  assertEquals(engineer, {
    read: ["/app", "/data/domains/dom_a", "/data/domains/dom_b"],
    write: ["/app", "/data/domains/dom_a", "/data/domains/dom_b"],
    base: "/app",
  });
  // 서로의 place에서는 아무것도 열리지 않는다
  assertEquals(
    placeScope({ ...base, role: "project_manager", place: app }),
    { read: [], write: [] },
  );
  assertEquals(
    placeScope({ ...base, role: "app_engineer", place: project }),
    { read: [], write: [] },
  );
  // 폴더 없는 project의 PM은 domain 폴더만 열고 상대 경로 기준은 data 폴더다
  assertEquals(
    placeScope({
      ...base,
      role: "project_manager",
      place: project,
      projectFolders: [],
      domains: [domain("dom_a")],
    }),
    {
      read: ["/data/domains/dom_a", workflows],
      write: ["/data/domains/dom_a", workflows],
      base: "/data/projects/prj_a",
    },
  );
});

Deno.test("domain A만 고른 Operator는 A의 artifacts 폴더만 연다", () => {
  const picked = [domain("dom_a")];
  // workflows/는 facts에 있어도 Operator에게 열리지 않는다
  assertEquals(
    placeScope({ ...base, place: project, domains: picked }),
    {
      read: ["/p1", "/p2", "/data/domains/dom_a/artifacts"],
      write: ["/p1", "/p2", "/data/domains/dom_a/artifacts"],
      base: "/p1",
    },
  );
  // 앱 place에서 앱 source는 읽기만 한다
  assertEquals(
    placeScope({ ...base, place: app, domains: picked }),
    {
      read: ["/app", "/data/domains/dom_a/artifacts"],
      write: ["/data/domains/dom_a/artifacts"],
      base: "/app",
    },
  );
});

Deno.test("lophn은 모든 project 폴더를 읽기만 하고 runtimeFolders는 열린 폴더의 합을 한 번씩 담는다", () => {
  assertEquals(placeScope({ ...base, role: "lophn", place: project }), {
    read: ["/p1", "/p2", "/q"],
    write: [],
  });
  assertEquals(
    runtimeFolders({
      projectFolders: ["/p1", "/p2", "/p1"],
      appSources: ["/app", "/p2"],
      domainFolders: ["/data/domains/dom_a"],
      workflowFolders: [workflows],
    }),
    {
      read: ["/p1", "/p2", "/app", "/data/domains/dom_a", workflows],
      write: ["/p1", "/p2", "/app", "/data/domains/dom_a", workflows],
    },
  );
});
