import { assert, assertEquals } from "@std/assert";
import {
  buildContextText,
  type ContextRead,
} from "../../lophn-agent/prompt-assembly/context-text.ts";
import type { PlaceContext } from "../../lophn-agent/prompt-assembly/model.ts";
import { type PlaceData, placeInfo, type PlaceProject } from "./place-info.ts";

function project(id: string, name: string): PlaceProject {
  return { id, name, purpose: `${name} purpose`, folders: [], subfolders: [] };
}

function context(
  name: string,
  projectId: string,
  attached: boolean,
): PlaceContext {
  const read: ContextRead = {
    name,
    version: 1,
    purpose: `${name} purpose`,
    project: { name: projectId, purpose: "", folders: [], subfolders: [] },
    types: [],
    searches: [],
    glossary: [],
  };
  return {
    name,
    project: projectId,
    attached,
    purpose: `${name} purpose`,
    version: "r1",
    text: buildContextText(read),
  };
}

const data: PlaceData = {
  self: { role: "operator", name: "Mina" },
  project: project("prj_1", "own"),
  app: null,
  agents: [],
  contexts: [
    context("attached-own", "prj_1", true),
    context("unattached-own", "prj_1", false),
    context("attached-other", "prj_2", true),
  ],
  apps: [],
  projects: [],
  release: null,
  artifacts: null,
};

Deno.test("읽을 자격 없는 context는 Operator의 place 정보에 없다", () => {
  for (const budget of [100_000, 80, 0]) {
    const text = placeInfo("operator", data, budget);
    assert(!text.includes("unattached-own"));
    assert(!text.includes("attached-other"));
  }
  assert(placeInfo("operator", data, 100_000).includes("attached-own"));
});

Deno.test("PM의 place 정보에 artifact 목록이 이름 순으로 실리고 50개를 넘으면 줄어든다", () => {
  const items = Array.from({ length: 52 }, (_, i) => ({
    name: `a${String(i).padStart(2, "0")}`,
    title: `Title ${i}`,
    description: i === 0 ? "" : "desc",
  }));
  const text = placeInfo("project_manager", {
    ...data,
    self: { role: "project_manager", name: "own" },
    artifacts: { folder: "/data/artifacts", items: items.reverse() },
  }, 100_000);
  assert(text.includes("Folder: /data/artifacts"));
  assert(text.includes("- a00: Title 0 (artifacts/a00/index.html)"));
  assert(text.includes("- a01: Title 1 — desc (artifacts/a01/index.html)"));
  assert(!text.includes("a50:"));
  assertEquals(text.split("\n").filter((l) => l === "2 more").length, 1);
  assert(!placeInfo("operator", data, 100_000).includes("Artifacts"));
});
