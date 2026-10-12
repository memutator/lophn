// lophn-agent/assignments#R2: 새 데이터 root에는 거두지 않은 lophn과 Context Engineer
// 전역 assignment가 각각 하나 있고 재시작이 중복을 만들지 않는다. 실제 core와
// temp LOPHN_HOME에서 본다(사람 데이터 root는 열지 않는다).
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import { startCore } from "./core.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const NOW = Date.UTC(2024, 0, 1);
const TOKEN = "b".repeat(43);

function user(n: number): AuthenticatedContext {
  return {
    principal: `user-${n}`,
    actor: "user",
    credential_ref: `cred_bootstrap${n}`,
    scope: {
      operations: ["ListAssignments", "ReadAssignment"],
      targets: {},
    },
    conditions: {},
  };
}

let credentials = 0;

async function start(
  home: string,
  options: Partial<Parameters<typeof startCore>[0]> = {},
) {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ lophnAgentDefinitions }, { createLedgerRegistration }],
    teamModules: [new URL("./lophn-agent.ts", import.meta.url).href],
    clock: manualClock(NOW),
    // 시작마다 다른 seed다. 같은 seed는 같은 credential ref를 만들어 기록이 겹친다.
    random: seededRandom(11 + credentials),
    testCredentials: true,
    ...options,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  assert(core.acceptTestCredential);
  // 재시작한 core는 다른 자격으로 읽는다. credential 기록은 core마다 새로 만든다.
  const context = user(++credentials);
  assert((await core.acceptTestCredential(context, TOKEN)).ok);
  assert((await core.record(context)).ok);
  guard.keep();
  return core;
}

async function read(port: number, path: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

type Listed = {
  assignments: {
    id: string;
    role: string;
    state: string;
    scope: { kind: string; id: string | null };
  }[];
};

async function builtins(port: number): Promise<Listed["assignments"]> {
  const listed = await read(port, "assignments/list", {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  return (listed.body as Listed).assignments;
}

Deno.test("lophn-agent/assignments#R2 [agent-R12]: a fresh core has exactly one enabled lophn and one Context Engineer assignment and no preset route", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-bootstrap-" });
  try {
    const core = await start(home);
    try {
      const assignments = await builtins(core.port);
      assertEquals(
        assignments.map((entry) => [entry.role, entry.state, entry.scope])
          .sort(),
        [
          ["context_engineer", "enabled", { kind: "all", id: null }],
          ["lophn", "enabled", { kind: "all", id: null }],
        ],
      );
      // 설정은 assignment가 아니라 agent 정의가 맡는다: 읽기에 preset 칸이 없고 preset route도 없다.
      for (const assignment of assignments) {
        assertEquals(Object.keys(assignment).sort(), [
          "id",
          "pause_reason",
          "revision",
          "role",
          "scope",
          "state",
        ]);
      }
      assertEquals(
        (await read(core.port, "presets/list", {})).status,
        404,
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("lophn-agent/assignments#R2 [agent-R12]: restarting the same data root creates no duplicate assignment", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-bootstrap-" });
  try {
    const first = await start(home);
    let before: Listed["assignments"];
    try {
      before = await builtins(first.port);
      assertEquals(before.length, 2);
    } finally {
      await first.shutdown();
    }
    for (let round = 0; round < 2; round++) {
      const again = await start(home);
      try {
        // 같은 id이고 새 assignment가 늘지 않는다.
        assertEquals(await builtins(again.port), before);
      } finally {
        await again.shutdown();
      }
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
