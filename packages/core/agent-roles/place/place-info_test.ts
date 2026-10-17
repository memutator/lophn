import { assert } from "@std/assert";
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
};

Deno.test("읽을 자격 없는 context는 Operator의 place 정보에 없다", () => {
  for (const budget of [100_000, 80, 0]) {
    const text = placeInfo("operator", data, budget);
    assert(!text.includes("unattached-own"));
    assert(!text.includes("attached-other"));
  }
  assert(placeInfo("operator", data, 100_000).includes("attached-own"));
});
