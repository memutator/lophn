import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { machinesAppTools } from "../../../protocol/remote/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import { appCallTool } from "../../../protocol/apps/mod.ts";
import { appCommands, appCommandTool } from "./app-tool/command.ts";
import { createAppToolkit, type RemoteMemo } from "./app-toolkit.ts";
import { LOPHN_TOOLS, withApps } from "./lophn/tool.ts";

const APP = "app_0000000000000000000000000a";
const STUDIO = {
  machine: "mch_0000000000000000000000000a",
  device: "dev_0000000000000000000000000a",
  name: "studio",
  self: false,
};
const remoteLine = {
  app: APP,
  machine: STUDIO.machine,
  name: "Notes",
  removed_tools: [],
};
const AGENT = { agent: "lophn_home", workspace: null } as never;

function toolkit(remote: () => Promise<unknown>, remoteReadMs = 20) {
  const paths: string[] = [];
  const kit = createAppToolkit({
    machine: async (path) => {
      paths.push(path);
      if (path === routePath(machinesAppTools)) {
        return ok(await remote()) as never;
      }
      return { ok: false, error: { code: "not_found", message: "none" } };
    },
    assignment: async () => ok({ entries: [remoteLine] }),
    remoteReadMs,
  });
  return { kit, paths };
}

const answer = { machines: [STUDIO], apps: [] };

// 다른 컴퓨터의 목록 읽기는 turn마다 한 번이고 늦는 컴퓨터를 기다리지 않는다.
test("다른 컴퓨터의 앱 목록은 한 turn에 한 번만 읽고, 답이 늦으면 읽지 못한 것으로 두고 turn이 계속된다", async () => {
  const fast = toolkit(async () => answer);
  const memo: RemoteMemo = {};
  assert.ok((await fast.kit.load(AGENT, memo)).ok);
  assert.ok((await fast.kit.load(AGENT, memo)).ok);
  assert.equal(
    fast.paths.filter((path) => path === routePath(machinesAppTools)).length,
    1,
  );

  const hung = toolkit(() => new Promise(() => {}));
  const loaded = await hung.kit.load(AGENT, {});
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.value.views, []);
  const found = appCommands(loaded.value);
  assert.deepEqual(found.unreachable, [
    { machine: STUDIO.machine, machineName: STUDIO.machine, name: "Notes" },
  ]);
});

// 내장 명령은 앱 목록(다른 컴퓨터를 읽는다)을 읽지 않는다. 맨 위 도움말만 한 번 읽는다.
test("lophn의 내장 명령은 앱 목록을 읽지 않고 맨 위 도움말은 한 번 읽는다", async () => {
  let reads = 0;
  const tool = withApps(LOPHN_TOOLS[0], async () => {
    reads += 1;
    return { entries: [], machines: [], unreachable: [] };
  });
  const run = (args: string[]) =>
    tool.handler!({ args }, { kind: "project" } as never);
  await run(["job", "--help"]);
  await run(["job", "list", "--bogus"]);
  await run(["job", "list", "--on", "studio"]);
  assert.equal(reads, 0);
  assert.ok((await run(["help"])).ok);
  assert.equal(reads, 1);
});

// 다른 컴퓨터가 고른 secret 이름으로 이 컴퓨터의 사람에게 secret을 청하지 않는다.
test("다른 컴퓨터의 앱 command가 secret이 비어 실패해도 이 컴퓨터에서 secret을 청하는 문장은 만들지 않는다", async () => {
  const found = appCommands({
    views: [
      {
        app: APP,
        machine: STUDIO.machine,
        slug: "notes",
        name: "Notes",
        release: "rel_0000000000000000000000000a",
        tools: [
          {
            name: "add",
            description: "Add a note",
            inputSchema: null,
            effect: "write",
            public: true,
          },
        ],
      },
    ],
    entries: [remoteLine],
    machines: [STUDIO],
  });
  const definition = appCommandTool(found.entries[0]);
  assert.match(definition.description, /runs on the computer studio/);
  const done = await definition.handler!({}, {
    session: "ses_0000000000000000000000000a",
    turn: "trn_0000000000000000000000000a",
    tool_call: "tcl_0000000000000000000000000a",
    core: async (path: string) => {
      assert.equal(path, routePath(appCallTool));
      return ok({
        invocation: null,
        outcome: {
          status: "failed",
          error: { code: "x", message: "nope" },
          missing: [{ app: APP, secret: "stripe_key" }],
        },
      });
    },
  } as never);
  assert.ok(done.ok);
  const text = JSON.stringify(done.value);
  assert.doesNotMatch(text, /lophn ask secret|stripe_key/);
  assert.match(done.value.summary, /on studio is missing something/);
});
