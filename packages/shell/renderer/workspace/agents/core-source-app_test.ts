// agent-I39: 앱 공간의 관리 화면이 Agents 탭과 같은 core 통로를 앱 자리로 쓴다. id 접두사(`app_`)가 자리를 정한다.
import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreAgentsSource } from "./core-source.ts";

const APP = "app_01k6p0000000000000000000aa";
const PROJECT = "prj_01k6p0000000000000000000aa";
const OPERATOR = "asg_01k6p0000000000000000000a2";
const META = { as_of_seq: "1", next_cursor: null };

function recordingCore(
  reply: (call: CoreCall) => CoreReply,
): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        return Promise.resolve(reply(input));
      },
    },
  };
}

function placeOf(call: CoreCall): unknown {
  const body = call.body as {
    place?: unknown;
    input?: { place?: unknown };
  };
  return body.place ?? body.input?.place;
}

Deno.test("shell/app-frame#R39 [agent-I39]: app_ id는 앱 자리로 목록을 읽고 저장하며 project id는 project 자리로 읽는다", async () => {
  const { core, calls } = recordingCore((call) =>
    call.resource === "agents" && call.method === "list"
      ? { ok: true, value: { ...META, agents: [] } }
      : {
        ok: true,
        value: { assignment: OPERATOR, role: "operator", hash: "b".repeat(64) },
      }
  );
  const source = coreAgentsSource(core, { random: () => "k" });
  await source.list(APP);
  await source.saveAgent(APP, {
    assignment: null,
    definition: { body: "" },
    hash: null,
  });
  await source.list(PROJECT);
  assertEquals(calls.map(placeOf), [
    { kind: "app", id: APP },
    { kind: "app", id: APP },
    { kind: "project", id: PROJECT },
  ]);
});

Deno.test("shell/app-frame#R39 [agent-I39]: 앱 자리의 LOPHN.md는 지침 통로의 app 층에서 연다", async () => {
  const targets: unknown[] = [];
  const instructions: InstructionsApi = {
    open: (input) => {
      targets.push(input.target);
      return Promise.resolve({
        ok: true,
        value: { document: null, version: null },
      });
    },
    create: () => Promise.reject(new Error("not used")),
  };
  const { core } = recordingCore((call) =>
    call.resource === "agents"
      ? { ok: true, value: { ...META, agents: [] } }
      : {
        ok: true,
        value: {
          ...META,
          settings: { mcp_servers: [] },
          hash: null,
          effective_models: {},
          skills: [],
        },
      }
  );
  await coreAgentsSource(core, { instructions }).overview(APP);
  await coreAgentsSource(core, { instructions }).overview(PROJECT);
  assertEquals(targets, [
    { layer: "app", place: APP },
    { layer: "project", place: PROJECT },
  ]);
});
