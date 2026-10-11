// apps/agent-runtime MCP 등록 통로 테스트다(lophn-agent#T37, Q16). 가짜 stdio
// child와 가짜 settings read로 본다. 사람의 실제 registry·실제 MCP server·
// 실제 model provider에 닿지 않는다. 파일은 temp dir만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../packages/base/mod.ts";
import {
  mcpServersSetting,
  placeExtensionSettingsRead,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import {
  checkMcpConfig,
  type McpConnectionsDeps,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { spawnStdioMcp } from "../../packages/lophn-agent/extensions/mod.ts";
import type { StdioSpawnInput } from "../../packages/lophn-agent/extensions/mod.ts";
import { ok, type Result } from "../../packages/base/mod.ts";
import { createMcpToolkit } from "./mcp-toolkit.ts";
import type { CoreCall } from "./core-call.ts";
import type { McpToolkit } from "./prepare.ts";
import type { ToolDefinition } from "../../packages/lophn-agent/harness/tools/mod.ts";

const clock = manualClock(0);

// ---- 가짜 stdio child ----
const CHILD_SCRIPT = `\
const dec = new TextDecoder();
let buf = "";
let failingList = false;
let slowList = false;
const names = ["a", "b"];
for (;;) {
  const chunk = new Uint8Array(4096);
  const n = await Deno.stdin.read(chunk);
  if (n === null) break;
  buf += dec.decode(chunk.subarray(0, n));
  for (;;) {
    const at = buf.indexOf("\\n");
    if (at < 0) break;
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (line.trim() === "") continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === "initialize") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } },
      }) + "\\n"));
      continue;
    }
    if (message.method === "tools/list") {
      if (failingList) {
        await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
          jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "no" },
        }) + "\\n"));
        continue;
      }
      if (slowList) {
        slowList = false;
        await new Promise((resolve) => setTimeout(resolve, 600));
        names.push("c");
      }
      const tool = (name) => ({ name, description: name + " desc", inputSchema: { type: "object", properties: {} } });
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, result: { tools: names.map(tool) },
      }) + "\\n"));
      continue;
    }
    if (message.method === "tools/call") {
      const name = message.params && message.params.name;
      if (name === "bump" || name === "break") {
        if (name === "bump") slowList = true; else failingList = true;
        await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
          jsonrpc: "2.0", method: "notifications/tools/list_changed",
        }) + "\\n"));
      }
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok" }] },
      }) + "\\n"));
      continue;
    }
  }
}
`;

let childPath: string | undefined;

async function writeChild(): Promise<string> {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-toolkit-test-" });
  const path = `${home}/fake-mcp-child.mjs`;
  await Deno.writeTextFile(path, CHILD_SCRIPT);
  return path;
}

// ---- 가짜 settings read ----
// settingsGet 결과다. machine 자격의 loopback 대신 판을 그대로 문다.
function settingsGetBody(servers: readonly unknown[]): CoreCall {
  const body = {
    settings: [{
      key: mcpServersSetting.key,
      value: servers.length === 0 ? null : servers,
      resolved: servers.length > 0,
      source_layer: servers.length > 0 ? "common" : null,
      choices: [],
      revision: 1,
      apply_at: "next_run",
    }],
    revision: 1,
    defaults_revision: "defaults-1",
    as_of_seq: "0",
    next_cursor: null,
  };
  return (path, request) => {
    void path;
    void request;
    return Promise.resolve(ok(body) as Result<unknown>);
  };
}

function stdioServer(revision = 1) {
  const script = childPath ?? "/lophn-mcp-test/none.mjs";
  const parsed = mcpServersSetting.value_type.parse([{
    name: "notes",
    revision,
    enabled: true,
    transport: "stdio",
    call_timeout_ms: 60_000,
    classifications: {},
    stdio: {
      executable: "/bin/sh",
      args: ["-c", `deno run --allow-read --allow-env ${script} normal`],
      cwd: null,
      env: {},
    },
  }]);
  if (!parsed[0] || parsed[0].transport !== "stdio") {
    throw new Error("기준 stdio server가 아니었다");
  }
  return parsed[0];
}

// ---- deps ----
function connectionsDeps(): McpConnectionsDeps {
  return {
    nowMs: () => clock.nowMs(),
    wait: () => Promise.resolve("elapsed" as const),
    deadline: async (ms: number, signal: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10_000)));
      return signal.aborted ? "aborted" as const : "elapsed" as const;
    },
    openStdio: (_server: unknown, input: StdioSpawnInput) =>
      Promise.resolve(
        spawnStdioMcp({
          ...input,
          env: { ...input.env, FAKE_CHILD: childPath ?? "" },
        }),
      ),
  };
}

const waitUntil = async (predicate: () => Promise<boolean>) => {
  for (let tries = 0; tries < 100; tries += 1) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

Deno.test("lophn-agent/extensions#R24 #R22 (Q16): list_changed면 그 server tool 목록 전체를 다시 읽고 끝날 때까지 호출을 막으며 재조회가 실패하면 옛 정의를 호출 가능으로 두지 않는다", async () => {
  childPath = await writeChild();
  const deps = connectionsDeps();
  const kit = createMcpToolkit({
    machine: settingsGetBody([stdioServer()]),
    connections: deps,
  });
  try {
    const toolkit = kit.toolkit("assignment-1");
    const invoke = (original: string, key: string) =>
      toolkit.call("assignment-1")({
        server: "notes",
        original,
        input: { x: 1 },
        requestKey: key,
      });
    const aDefinition = {
      description: "MCP tool a of server notes: a desc (reads only)",
    } as ToolDefinition;

    // 처음 목록은 a·b다. 재조회가 끝나 있어 호출이 통과하고 설정 판을 건넨다.
    const source = await toolkit.source("assignment-1");
    assert(source.ok, `source 실패: ${source.ok ? "" : source.error.message}`);
    assertEquals(source.value.tools.map((tool) => tool.original), ["a", "b"]);
    assertEquals(
      toolkit.connectionRevision(aDefinition, "assignment-1"),
      { revision: 1 },
    );
    assert((await invoke("a", "tcl_1")).ok);

    // 서버가 list_changed를 알리면 전체 재조회가 끝날 때까지(600ms) 그 server의 호출은
    // 거절이고 판정 근거의 연결도 없다(Q16).
    assert((await invoke("bump", "tcl_2")).ok);
    const blocked = await invoke("a", "tcl_3");
    assert(!blocked.ok, "재조회 중 호출이 통과했다");
    assertEquals(blocked.error.code, "unavailable");
    assertEquals(
      toolkit.connectionRevision(aDefinition, "assignment-1"),
      undefined,
    );

    // 재조회가 끝나면 호출이 다시 통과하고 새 목록 전체(a·b·c)가 보인다.
    assert(await waitUntil(async () => (await invoke("a", "tcl_4")).ok));
    assertEquals(
      toolkit.connectionRevision(aDefinition, "assignment-1"),
      { revision: 1 },
    );
    const relisted = await toolkit.source("assignment-1");
    assert(relisted.ok);
    assertEquals(
      relisted.value.tools.map((tool) => tool.original),
      ["a", "b", "c"],
    );

    // 재조회가 실패하면 옛 정의를 호출 가능으로 두지 않는다. 기다려도 계속 거절이다.
    assert((await invoke("break", "tcl_5")).ok);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const failed = await invoke("a", "tcl_6");
    assert(!failed.ok, "재조회 실패 뒤 옛 정의 호출이 통과했다");
    assertEquals(
      toolkit.connectionRevision(aDefinition, "assignment-1"),
      undefined,
    );
  } finally {
    await kit.endAll();
    await Deno.remove(childPath!, { recursive: true }).catch(() => {});
  }
});

// checkMcpConfig가 문제 서버를 골라내는지 본다(mcp-config R12).
Deno.test("lophn-agent/extensions#R12: 문제·비활성 서버는 source 목록에 없다", () => {
  const checked = checkMcpConfig([stdioServer()]);
  assert(checked.ok);
  assertEquals(checked.value.valid.length, 1);
  const bad = { ...stdioServer(), stdio: {} } as unknown;
  const invalid = checkMcpConfig([bad as never]);
  assert(invalid.ok);
  assertEquals(invalid.value.valid.length, 0);
});

// ---- 자리 층(agent-I19b) ----
const PRJ_PLACE = {
  kind: "project" as const,
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
};
const OTHER_PLACE = {
  kind: "project" as const,
  id: "prj_01arz3ndektsv4rrffq69g5fa9",
};

function named(name: string, revision = 1) {
  return { ...stdioServer(revision), name };
}

// 전역 설정(settings/get)과 자리별 서버 목록(place-extension-settings/read)에 답하는 core다.
function routedCalls(
  global: readonly unknown[],
  places: Record<string, readonly unknown[]>,
  failPlaceRead = false,
): CoreCall {
  const settings = settingsGetBody(global);
  return (path, request) => {
    if (path === routePath(placeExtensionSettingsRead)) {
      if (failPlaceRead) {
        return Promise.resolve(
          {
            ok: false,
            error: { code: "unavailable", message: "down" },
          } as Result<unknown>,
        );
      }
      const place = (request as { place: { id: string } }).place;
      return Promise.resolve(ok({
        place: (request as { place: unknown }).place,
        settings: { revision: 1, mcp_servers: places[place.id] ?? [] },
        hash: null,
        skills: [],
        shadowed: [],
        skipped: [],
        as_of_seq: "1",
        next_cursor: null,
      }) as Result<unknown>);
    }
    return settings(path, request);
  };
}

async function sourced(
  kit: ReturnType<typeof createMcpToolkit>,
  assignment: string,
  options: Parameters<McpToolkit["source"]>[1],
) {
  const source = await kit.toolkit(assignment).source(assignment, options);
  assert(source.ok, source.ok ? "" : source.error.message);
  return {
    servers: [...source.value.servers.keys()].sort(),
    tools: [...new Set(source.value.tools.map((tool) => tool.server))].sort(),
    revision: (name: string) => source.value.servers.get(name)?.revision,
  };
}

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: 자리의 MCP 서버는 그 자리에서 여는 agent의 연결에만 더해진다", async () => {
  childPath = await writeChild();
  const kit = createMcpToolkit({
    machine: routedCalls([named("notes")], {
      [PRJ_PLACE.id]: [named("scoped")],
    }),
    connections: connectionsDeps(),
  });
  try {
    const here = await sourced(kit, "assignment-1", { place: PRJ_PLACE });
    assertEquals(here.servers, ["notes", "scoped"]);
    assertEquals(here.tools, ["notes", "scoped"]);
    const elsewhere = await sourced(kit, "assignment-2", {
      place: OTHER_PLACE,
    });
    assertEquals(elsewhere.servers, ["notes"]);
    // 자리를 모르는 연결은 전역 서버만 쓴다.
    const none = await sourced(kit, "assignment-3", { place: null });
    assertEquals(none.servers, ["notes"]);
  } finally {
    await kit.endAll();
    await Deno.remove(childPath!, { recursive: true }).catch(() => {});
  }
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: 전역과 같은 이름의 자리 서버는 쓰지 않고 자리 서버를 읽지 못하면 전역 서버만 남는다", async () => {
  childPath = await writeChild();
  try {
    const clash = createMcpToolkit({
      machine: routedCalls([named("notes", 1)], {
        [PRJ_PLACE.id]: [named("notes", 9)],
      }),
      connections: connectionsDeps(),
    });
    try {
      const seen = await sourced(clash, "assignment-1", { place: PRJ_PLACE });
      assertEquals(seen.servers, ["notes"]);
      assertEquals(seen.revision("notes"), 1);
    } finally {
      await clash.endAll();
    }
    const down = createMcpToolkit({
      machine: routedCalls([named("notes")], {}, true),
      connections: connectionsDeps(),
    });
    try {
      const seen = await sourced(down, "assignment-1", { place: PRJ_PLACE });
      assertEquals(seen.servers, ["notes"]);
    } finally {
      await down.endAll();
    }
  } finally {
    await Deno.remove(childPath!, { recursive: true }).catch(() => {});
  }
});

Deno.test("lophn-agent/extensions#R18 lophn-agent/extensions#R31 [agent-I19b]: agent 정의가 통째로 끈 서버는 연결하지 않는다", async () => {
  childPath = await writeChild();
  const kit = createMcpToolkit({
    machine: routedCalls([named("notes")], {
      [PRJ_PLACE.id]: [named("scoped")],
    }),
    connections: connectionsDeps(),
  });
  try {
    const skipped = await sourced(kit, "assignment-1", {
      place: PRJ_PLACE,
      skip: new Set(["scoped"]),
    });
    assertEquals(skipped.servers, ["notes"]);
    assertEquals(skipped.tools, ["notes"]);
    const allOff = await sourced(kit, "assignment-2", {
      place: PRJ_PLACE,
      skip: new Set(["notes", "scoped"]),
    });
    assertEquals(allOff.servers, []);
    assertEquals(allOff.tools, []);
  } finally {
    await kit.endAll();
    await Deno.remove(childPath!, { recursive: true }).catch(() => {});
  }
});
