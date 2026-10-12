// lophn-agent/assignments#R4 lophn-agent/assignments#R9 [agent-R12]: 실제 core에서 사람이 새 Operator 정의를
// 저장하면 assignment가 같이 생겨 목록에 보이고, 삭제하면 assignment가 거둬지고 목록에서 사라진다. 저장이
// 실패하면 assignment도 남지 않는다. core는 temp LOPHN_HOME에서 실제 자식 process와 함께 뜬다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../projects/register.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "../register.ts";
import { createCoreHarness } from "../../testing/core.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

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

function token(result: Result<{ token: string }>): string {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value.token;
}

type Row = { assignment: string; role: string; kind: string; name: string };

Deno.test("lophn-agent/assignments#R4 lophn-agent/assignments#R9 [agent-R12]: saving a new Operator makes its assignment and shows it in the list, deleting withdraws it and the list drops it", async () => {
  const harness = await createCoreHarness({
    io: true,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("../../projects/register.ts", import.meta.url).href,
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
  const core = harness.value;
  try {
    const user = token(
      await core.credential({
        actor: "user",
        principal: "user-1",
        scope: {
          operations: [
            "project.create",
            "SaveAgent",
            "DeleteAgent",
            "CreateOperatorAssignment",
            "WithdrawAssignment",
            "ListAgents",
            "ReadAgent",
            "ListAssignments",
            "ReadAssignment",
          ],
          targets: {},
        },
        conditions: {},
      }),
    );
    const place = { kind: "project", id: PROJECT };
    const created = await post(
      core.port,
      "/v1/projects/create",
      user,
      command({
        id: PROJECT,
        name: "alpha",
        title: "Alpha",
        purpose: "",
        folders: [],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));

    const listed = async (): Promise<Row[]> => {
      const response = await post(core.port, "/v1/agents/list", user, {
        place,
      });
      assertEquals(response.status, 200, JSON.stringify(response.body));
      return response.body["agents"] as Row[];
    };
    const operators = async () =>
      (await listed()).filter((row) => row.kind === "operator");
    assertEquals(await operators(), []);

    // 새 Operator 정의를 저장하면 assignment가 같이 생기고 목록에 보인다.
    const saved = await post(
      core.port,
      "/v1/agents/save",
      user,
      command({
        place,
        definition: { name: "Release watcher", body: "Watch the releases." },
      }, { hash: null }),
    );
    assertEquals(saved.status, 200, JSON.stringify(saved.body));
    const assignment = saved.body["assignment"] as string;
    assertEquals(saved.body["role"], "operator");
    const shown = await operators();
    assertEquals(shown.map((row) => [row.assignment, row.name]), [
      [assignment, "Release watcher"],
    ]);
    const read = await post(core.port, "/v1/assignments/read", user, {
      assignment,
    });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const record = read.body["assignment"] as Record<string, unknown>;
    assertEquals(
      [record["role"], record["state"], record["scope"]],
      ["operator", "enabled", place],
    );

    // 같은 정의를 다시 저장해도 assignment는 늘지 않는다.
    const again = await post(
      core.port,
      "/v1/agents/save",
      user,
      command({
        place,
        assignment,
        definition: { name: "Release watcher", body: "Watch more." },
      }, { hash: saved.body["hash"] }),
    );
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals((await operators()).length, 1);

    // 삭제하면 assignment가 거둬지고 목록에서 사라진다. 읽기에는 거둔 기록이 남는다.
    const deleted = await post(
      core.port,
      "/v1/agents/delete",
      user,
      command({ assignment }, { hash: again.body["hash"] }),
    );
    assertEquals(deleted.status, 200, JSON.stringify(deleted.body));
    assertEquals(await operators(), []);
    const after = await post(core.port, "/v1/assignments/read", user, {
      assignment,
    });
    assertEquals(
      (after.body["assignment"] as Record<string, unknown>)["state"],
      "withdrawn",
    );

    // 정의 저장이 실패하면 방금 만든 assignment도 남지 않는다.
    const before = (await post(core.port, "/v1/assignments/list", user, {}))
      .body["assignments"] as unknown[];
    const refused = await post(
      core.port,
      "/v1/agents/save",
      user,
      command({
        place,
        definition: { name: "lophn", body: "A reserved name." },
      }, { hash: null }),
    );
    assert(refused.status >= 400, JSON.stringify(refused.body));
    assertEquals(
      ((await post(core.port, "/v1/assignments/list", user, {}))
        .body["assignments"] as unknown[]).length,
      before.length,
    );
  } finally {
    await core.close();
  }
});
