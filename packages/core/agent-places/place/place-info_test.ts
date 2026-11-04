import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type { ResolvedAgent } from "../../lophn-agent/agents/mod.ts";
import type { CoreCall } from "../../lophn-agent/run-loop/core-call.ts";
import { placeData, type PlaceFiles } from "./place-data.ts";

const id = (prefix: string, n: string) => `${prefix}_0${"0".repeat(24)}${n}`;
const APP = id("app", "1");
const common = { as_of_seq: "1", next_cursor: null };

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
  skillsFolder: (place) => `/data/${place.id}/skills`,
  dataFolder: (place) => `/data/${place.id}`,
  workflowsFolder: (project) => `/data/${project}/workflows`,
  artifactsFolder: (place) => `/data/${place.id}/artifacts`,
  ensureDir: () => Promise.resolve(),
  listArtifacts: () =>
    Promise.resolve([{ name: "a-page", title: "T", description: "" }]),
};

function agent(place: unknown, name = "x") {
  return { place, name } as unknown as ResolvedAgent;
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
const SKILLS = `/data/${APP}/skills`;

test("앱 place의 정보와 쓰기 범위에는 그 앱의 skills·artifacts 폴더가 있다", async () => {
  const call = fakeCall({
    "/apps/get": { app },
    "/agents/list": { agents: [] },
  });
  const read = await placeData(call, agent(appPlace), files);
  assert.ok(read.ok);
  const text = read.value.place.text;
  assert.ok(text.includes(`Skills folder: ${SKILLS}\n`));
  assert.ok(text.includes("a-page") && text.includes(`${ARTIFACTS}\n`));
  assert.deepStrictEqual(read.value.scope, {
    read: ["/src/ledger", SKILLS, ARTIFACTS],
    write: ["/src/ledger", SKILLS, ARTIFACTS],
    base: "/src/ledger",
  });
});

test("home의 앱 목록에는 공개 command와 쓰는 곳이 실리고 package는 주인 앱 줄에 실린다", async () => {
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
  const read = await placeData(call, agent(null, "lophn"), files);
  assert.ok(read.ok);
  const text = read.value.place.text;
  assert.ok(
    text.includes("`lophn ledger <command>`): show (read) show does it"),
  );
  assert.ok(!text.includes("hidden"));
  assert.ok(text.includes(`show ← ${id("prj", "2")}`));
  assert.ok(
    text.includes("- Ledger: keeps the books\n  Packages: @me/ui@1.0.0"),
  );
});
