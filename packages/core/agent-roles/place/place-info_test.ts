import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type { ResolvedAgent } from "../../lophn-agent/agents/mod.ts";
import type { CoreCall } from "../../lophn-agent/run-loop/core-call.ts";
import { placeData, type PlaceFiles } from "./place-data.ts";

const id = (prefix: string, n: string) => `${prefix}_0${"0".repeat(24)}${n}`;
const APP = id("app", "1");
const DOM_A = id("dom", "1");
const DOM_B = id("dom", "2");
const common = { as_of_seq: "1", next_cursor: null };

function domain(dom: string, name: string, owner = APP) {
  return {
    id: dom,
    name,
    title: `${name} title`,
    purpose: `${name} purpose`,
    owner: { kind: "app", id: owner },
    revision: "1",
    status: "active",
  };
}

const app = {
  id: APP,
  slug: "ledger",
  project: id("prj", "1"),
  name: "Ledger",
  description: "keeps the books",
  planning_version: null,
  source_path: "/src/ledger",
  active_release: null,
  revision: "1",
  run_enabled: false,
  status: "active",
};

const files: PlaceFiles = {
  domainFolder: (dom) => `/d/${dom}`,
  dataFolder: (place) => `/data/${place.id}`,
  workflowsFolder: (project) => `/data/${project}/workflows`,
  ensureDir: () => Promise.resolve(),
  listArtifacts: (folder) =>
    Promise.resolve([{
      name: folder.includes(DOM_A) ? "a-page" : "b-page",
      title: "T",
      description: "",
    }]),
};

function agent(role: string, place: unknown, domains: string[]) {
  return {
    agent: role === "lophn" ? { role } : { role, app: APP },
    role,
    place,
    name: "x",
    domains,
  } as unknown as ResolvedAgent;
}

// 응답은 route의 output schema로 다시 검사되므로 모양이 틀리면 읽기가 실패해 시험이 깨진다.
function fakeCall(replies: Record<string, unknown>): CoreCall {
  return (path, body) => {
    const reply = replies[path];
    if (typeof reply === "function") {
      return Promise.resolve(ok((reply as (b: unknown) => unknown)(body)));
    }
    return Promise.resolve(
      reply === undefined
        ? err({ code: "not_found", message: path })
        : ok({ ...common, ...(reply as object) }),
    );
  };
}

const appPlace = { kind: "app", id: APP };

test("domain A만 고른 Operator의 범위와 place 정보에는 A의 것만 있고 App Engineer에는 그릇의 domain 전부가 있다", async () => {
  const kind = (name: string) => ({
    name,
    summary: `${name} doc`,
    files: ["*.md"],
    key: "path",
    fields: {},
  });
  const call = fakeCall({
    "/apps/get": { app },
    "/calls/sendable": { sessions: [], queued_coding: [] },
    "/domains/list": {
      domains: [domain(DOM_A, "alpha"), domain(DOM_B, "beta")],
    },
    "/kinds/get": (body: unknown) => {
      const dom = (body as { domain: string }).domain;
      return {
        domain: dom,
        status: {
          file: `/d/${dom}/kinds.yaml`,
          state: "valid",
          using: "current",
          errors: [],
          applied_hash: "a".repeat(64),
        },
        kinds: [kind(dom === DOM_A ? "note" : "secret")],
      };
    },
  });
  const operator = await placeData(
    call,
    agent("operator", appPlace, [DOM_A]),
    files,
  );
  assert.ok(operator.ok);
  const text = operator.value.place.text;
  assert.ok(text.includes("alpha") && text.includes("note"));
  assert.ok(text.includes("a-page") && text.includes(`/d/${DOM_A}/artifacts`));
  for (const other of ["beta", "secret", "b-page", DOM_B]) {
    assert.ok(!text.includes(other), other);
  }
  // DOMAIN.md·kinds.yaml·skills/가 든 domain 폴더는 Operator에게 열리지 않는다
  assert.ok(!text.includes(`Folder: /d/${DOM_A}\n`));
  assert.deepStrictEqual(operator.value.scope, {
    read: ["/src/ledger", `/d/${DOM_A}/artifacts`],
    write: [`/d/${DOM_A}/artifacts`],
    base: "/src/ledger",
  });

  const engineer = await placeData(
    call,
    agent("app_engineer", appPlace, [DOM_A, DOM_B]),
    files,
  );
  assert.ok(engineer.ok);
  for (const seen of ["alpha", "beta", "note", "secret", "a-page", "b-page"]) {
    assert.ok(engineer.value.place.text.includes(seen), seen);
  }
  assert.ok(engineer.value.place.text.includes(`Folder: /d/${DOM_A}\n`));
  assert.deepStrictEqual(engineer.value.scope.write, [
    "/src/ledger",
    `/d/${DOM_A}`,
    `/d/${DOM_B}`,
  ]);
});

test("lophn의 지도에는 공개 tool만 실리고 package는 주인 앱 줄에 실린다", async () => {
  const tool = (name: string, isPublic: boolean) => ({
    name,
    title: name,
    description: `${name} does it`,
    effect: "read",
    public: isPublic,
    domain: "alpha",
  });
  const call = fakeCall({
    "/projects/list": { projects: [] },
    "/apps/list": { apps: [app] },
    "/calls/sendable": { sessions: [], queued_coding: [] },
    "/domains/list": {
      domains: [domain(DOM_A, "alpha"), domain(DOM_B, "beta")],
    },
    "/apps/tool_index": {
      apps: [{
        app: APP,
        name: "Ledger",
        description: "keeps the books",
        tools: [tool("show", true), tool("hidden", false)],
      }],
    },
    "/apps/usage": {
      uses: [{ app: APP, tool: "show", domain: DOM_B, source: "grant" }],
    },
    "/packages/list": {
      packages: [{
        id: id("pkg", "1"),
        name: "@me/ui",
        description: "ui",
        owner_app: APP,
        versions: [{
          version: "1.0.0",
          bundle_hash: "b".repeat(64),
          guide_hash: "c".repeat(64),
        }],
      }],
    },
  });
  const read = await placeData(call, agent("lophn", null, []), files);
  assert.ok(read.ok);
  const text = read.value.place.text;
  assert.ok(text.includes("show (read) show does it"));
  assert.ok(!text.includes("hidden"));
  assert.ok(text.includes("show ← beta"));
  assert.ok(
    text.includes("- Ledger: keeps the books\n  Packages: @me/ui@1.0.0"),
  );
});

test("project의 workflows 폴더는 그 place의 PM의 prompt와 쓰기 범위에만 있고 Operator에는 없다", async () => {
  const PRJ = id("prj", "1");
  const call = fakeCall({
    "/projects/get": {
      project: {
        id: PRJ,
        name: "books",
        title: "Books",
        purpose: "p",
        revision: "1",
        status: "active",
        folders: [{
          path: "/p1",
          description: "d",
          subfolders: [],
          found: true,
        }],
      },
    },
    "/calls/sendable": { sessions: [], queued_coding: [] },
    "/domains/list": { domains: [] },
  });
  const projectPlace = { kind: "project", id: PRJ };
  const workflows = `/data/${PRJ}/workflows`;
  const pm = await placeData(
    call,
    {
      ...agent("project_manager", projectPlace, []),
      agent: { role: "project_manager", project: PRJ },
    } as ResolvedAgent,
    files,
  );
  assert.ok(pm.ok);
  assert.ok(pm.value.place.text.includes(`Workflows folder: ${workflows}\n`));
  assert.deepStrictEqual(pm.value.scope.write, ["/p1", workflows]);
  const operator = await placeData(
    call,
    agent("operator", projectPlace, []),
    files,
  );
  assert.ok(operator.ok);
  assert.ok(!operator.value.place.text.includes("Workflows folder"));
  assert.deepStrictEqual(operator.value.scope.write, ["/p1"]);
});
