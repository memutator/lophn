// lophn-agent/assignments#R1: 제품 core 경로에서 AppCreated가 거두지 않은 App Engineer
// assignment 하나를 만들고, AppArchived가 그것을 멈추며, AppUnarchived가 자동으로 켜지 않는다.
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
  preset: string;
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

Deno.test("lophn-agent/assignments#R1: core의 AppCreated 반응이 앱마다 거두지 않은 AE 하나를 만들고 보관은 멈추며 보관 해제는 켜지 않는다", async () => {
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
            "ListPresets",
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
    // core 기동의 준비가 AE product preset을 등록할 때까지 기다린다.
    const preset = await until(async () => {
      const listed = await post(core.port, "/v1/presets/list", user, {
        kind: "app_engineer",
        origin: "product",
      });
      const presets = listed.body["presets"] as { id: string }[] | undefined;
      return presets?.[0];
    }, "the App Engineer product preset");

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

    // 앱마다 거두지 않은 AE 하나가 enabled로 생기고 그 product preset을 쓴다.
    const made = await until(async () => {
      const list = await engineers();
      return list.length === 2 ? list : undefined;
    }, "two App Engineer assignments");
    for (const id of [app, otherApp]) {
      const mine = made.filter((entry) => entry.scope.id === id);
      assertEquals(mine.length, 1, id);
      assertEquals(
        [mine[0]!.role, mine[0]!.state, mine[0]!.preset, mine[0]!.scope.kind],
        ["app_engineer", "enabled", preset.id, "app"],
      );
    }

    // 담당 앱 보관은 그 AE만 멈춘다(scope_archived). 다른 앱의 AE는 그대로다.
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
      const mine = (await engineers()).find((entry) => entry.scope.id === app);
      return mine?.state === "paused" ? mine : undefined;
    }, "the archived app's assignment to pause");
    assertEquals(paused.pause_reason?.kind, "scope_archived");
    assertEquals(paused.pause_reason?.target, app);
    assertEquals(
      (await engineers()).find((entry) => entry.scope.id === otherApp)?.state,
      "enabled",
    );

    // 보관 해제는 자동으로 켜지 않는다. 재개는 사람의 ResumeAssignment뿐이다.
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
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = (await engineers()).filter((entry) => entry.scope.id === app);
    assertEquals(after.map((entry) => entry.state), ["paused"]);
  } finally {
    await core.close();
  }
});
