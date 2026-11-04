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
  folders: [],
  active_release: null,
  revision: "1",
  run_enabled: false,
  status: "active",
};

const files: PlaceFiles = {
  domainFolder: (dom) => `/d/${dom}`,
  dataFolder: (place) => `/data/${place.id}`,
  workflowsFolder: (project) => `/data/${project}/workflows`,
  artifactsFolder: (place) => `/data/${place.id}/artifacts`,
  ensureDir: () => Promise.resolve(),
  listArtifacts: () =>
    Promise.resolve([{ name: "a-page", title: "T", description: "" }]),
};

function agent(place: unknown, domains: string[], name = "x") {
  return { place, name, domains } as unknown as ResolvedAgent;
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
const ARTIFACTS = `/data/${APP}/artifacts`;

test("받은 domain이 A뿐인 session의 place 정보와 쓰기 범위에는 A의 것만 있다", async () => {
  const call = fakeCall({
    "/apps/get": { app },
    "/agents/list": { agents: [] },
    "/domains/list": {
      domains: [domain(DOM_A, "alpha"), domain(DOM_B, "beta")],
    },
  });
  const one = await placeData(call, agent(appPlace, [DOM_A]), files);
  assert.ok(one.ok);
  const text = one.value.place.text;
  assert.ok(text.includes("alpha"));
  assert.ok(text.includes("a-page") && text.includes(`${ARTIFACTS}\n`));
  assert.ok(text.includes(`Folder: /d/${DOM_A}\n`));
  for (const other of ["beta", DOM_B]) {
    assert.ok(!text.includes(other), other);
  }
  // artifacts/는 받은 domain과 상관없이 그 앱 place의 session이 쓴다.
  assert.deepStrictEqual(one.value.scope, {
    read: ["/src/ledger", `/d/${DOM_A}`, ARTIFACTS],
    write: ["/src/ledger", `/d/${DOM_A}`, ARTIFACTS],
    base: "/src/ledger",
  });

  const both = await placeData(call, agent(appPlace, [DOM_A, DOM_B]), files);
  assert.ok(both.ok);
  for (const seen of ["alpha", "beta", "a-page"]) {
    assert.ok(both.value.place.text.includes(seen), seen);
  }
  assert.deepStrictEqual(both.value.scope.write, [
    "/src/ledger",
    `/d/${DOM_A}`,
    `/d/${DOM_B}`,
    ARTIFACTS,
  ]);
});

test("home의 지도에는 공개 tool만 실리고 package는 주인 앱 줄에 실린다", async () => {
  const tool = (name: string, isPublic: boolean) => ({
    name,
    title: name,
    description: `${name} does it`,
    effect: "read",
    public: isPublic,
  });
  const call = fakeCall({
    "/projects/list": { projects: [] },
    "/apps/list": { apps: [app] },
    "/agents/list": { agents: [] },
    "/domains/list": {
      domains: [domain(DOM_A, "alpha"), domain(DOM_B, "beta")],
    },
    "/apps/tool_index": {
      apps: [
        {
          app: APP,
          name: "Ledger",
          description: "keeps the books",
          tools: [tool("show", true), tool("hidden", false)],
        },
      ],
    },
    "/apps/usage": {
      uses: [
        {
          app: APP,
          tool: "show",
          place: { kind: "project", id: id("prj", "2") },
          source: "grant",
        },
      ],
    },
    "/packages/list": {
      packages: [
        {
          id: id("pkg", "1"),
          name: "@me/ui",
          description: "ui",
          owner_app: APP,
          versions: [
            {
              version: "1.0.0",
              bundle_hash: "b".repeat(64),
              guide_hash: "c".repeat(64),
            },
          ],
        },
      ],
    },
  });
  const read = await placeData(call, agent(null, [], "lophn"), files);
  assert.ok(read.ok);
  const text = read.value.place.text;
  assert.ok(text.includes("show (read) show does it"));
  assert.ok(!text.includes("hidden"));
  assert.ok(text.includes(`show ← ${id("prj", "2")}`));
  assert.ok(
    text.includes("- Ledger: keeps the books\n  Packages: @me/ui@1.0.0"),
  );
});
