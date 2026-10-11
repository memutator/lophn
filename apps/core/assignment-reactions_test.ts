// lophn-agent/assignments#R1: 제품 core 경로에서 AppCreated가 거두지 않은 App Engineer
// assignment 하나를 만들고, AppArchived가 그 앱의 켜진 assignment(Operator 포함)를 멈추며,
// AppUnarchived가 다시 켠다.
// 실제 core·실제 ledger·temp 데이터 root에서 본다(사람 데이터 root는 열지 않는다). 반응은
// 주입이 아니라 core 기동이 연 구독자(machine:lophn-agent-assignments)가 낸다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../packages/base/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { createCoreHarness } from "./testing/core.ts";

type Assignment = {
  id: string;
  role: string;
  state: string;
  scope: { kind: string; id: string | null };
  pause_reason?: { kind: string; target: string | null } | null;
};

async function post(
  port: number,
  path: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function command(input: unknown, compare: unknown = {}) {
  return {
    input,
    idempotency_key: `k-${crypto.randomUUID()}`,
    compare,
    prepared: [],
  };
}

function value(result: Result<{ token: string }>): string {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value.token;
}

async function until<T>(
  read: () => Promise<T | undefined>,
  what: string,
): Promise<T> {
  for (let wait = 0; wait < 200; wait++) {
    const found = await read();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

Deno.test("lophn-agent/assignments#R1 [agent-R12]: core의 AppCreated 반응이 앱마다 거두지 않은 AE 하나를 만들고 보관은 그 앱의 AE와 Operator를 멈추며 보관 해제는 다시 켠다", async () => {
  const harness = await createCoreHarness({
    io: true,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
    ],
  });
  assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
  const core = harness.value;
  try {
    const user = value(
      await core.credential({
        actor: "user",
        principal: "user-1",
        scope: {
          operations: [
            "app.create",
            "app.archive",
            "app.unarchive",
            "ListAssignments",
            "CreateOperatorAssignment",
          ],
          targets: {},
        },
        conditions: {},
      }),
    );
    const engineers = async (): Promise<Assignment[]> => {
      const listed = await post(
        core.port,
        "/v1/assignments/list",
        user,
        { role: "app_engineer" },
      );
      assertEquals(listed.status, 200, JSON.stringify(listed.body));
      return listed.body["assignments"] as Assignment[];
    };
    const created = await post(
      core.port,
      "/v1/apps/create",
      user,
      command({ slug: "notes", name: "Notes", description: "notes app" }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = created.body["id"] as string;
    const other = await post(
      core.port,
      "/v1/apps/create",
      user,
      command({ slug: "todo", name: "Todo", description: "todo app" }),
    );
    assertEquals(other.status, 200, JSON.stringify(other.body));
    const otherApp = other.body["id"] as string;

    // 앱마다 거두지 않은 AE 하나가 enabled로 생긴다.
    const made = await until(async () => {
      const list = await engineers();
      return list.length === 2 ? list : undefined;
    }, "two App Engineer assignments");
    for (const id of [app, otherApp]) {
      const mine = made.filter((entry) => entry.scope.id === id);
      assertEquals(mine.length, 1, id);
      assertEquals(
        [mine[0]!.role, mine[0]!.state, mine[0]!.scope.kind],
        ["app_engineer", "enabled", "app"],
      );
    }

    // 사람이 앱에 Operator를 만든다.
    const operator = "asg_01arz3ndektsv4rrffq69g5fav";
    const madeOperator = await post(
      core.port,
      "/v1/assignments/create-operator",
      user,
      command({ id: operator, scope: { kind: "app", id: app } }),
    );
    assertEquals(madeOperator.status, 200, JSON.stringify(madeOperator.body));
    const everyone = async (): Promise<Assignment[]> => {
      const listed = await post(core.port, "/v1/assignments/list", user, {});
      assertEquals(listed.status, 200, JSON.stringify(listed.body));
      return (listed.body["assignments"] as Assignment[]).filter((entry) =>
        entry.scope.id === app
      );
    };

    // 담당 앱 보관은 그 앱의 AE와 Operator를 멈춘다(scope_archived). 다른 앱의 AE는 그대로다.
    const archived = await post(
      core.port,
      "/v1/apps/archive",
      user,
      command(
        { app },
        { base_revision: created.body["revision"] },
      ),
    );
    assertEquals(archived.status, 200, JSON.stringify(archived.body));
    const paused = await until(async () => {
      const mine = await everyone();
      return mine.length === 2 &&
          mine.every((entry) => entry.state === "paused")
        ? mine
        : undefined;
    }, "the archived app's assignments to pause");
    for (const entry of paused) {
      assertEquals(entry.pause_reason?.kind, "scope_archived");
      assertEquals(entry.pause_reason?.target, app);
    }
    assertEquals(
      (await engineers()).find((entry) => entry.scope.id === otherApp)?.state,
      "enabled",
    );

    // 보관을 풀면 machine이 둘을 다시 켠다. 사람이 재개하는 길은 없다.
    const unarchived = await post(
      core.port,
      "/v1/apps/unarchive",
      user,
      command(
        { app },
        { base_revision: archived.body["revision"] },
      ),
    );
    assertEquals(unarchived.status, 200, JSON.stringify(unarchived.body));
    const resumed = await until(async () => {
      const mine = await everyone();
      return mine.every((entry) => entry.state === "enabled")
        ? mine
        : undefined;
    }, "the unarchived app's assignments to resume");
    assertEquals(resumed.length, 2);
    for (const entry of resumed) assertEquals(entry.pause_reason, null);
    assertEquals(
      (await post(
        core.port,
        "/v1/assignments/resume",
        user,
        command({ assignment: operator }, { revision: 3, state: "paused" }),
      )).status,
      403,
    );
  } finally {
    await core.close();
  }
});
