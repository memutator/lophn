import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import { seededRandom } from "../../packages/base/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";

// 제품 경로의 writer 시각이 core 기동 시각에 고정되지 않는지 본다(ledger R3, R8).
// writerClock "system"은 writer가 자기 system clock을 쓴다. 사이에 실제 시간이
// 지나면 두 command의 event `at`이 커져야 한다.

async function post(
  core: Core,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${core.port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function project(id: string, name: string) {
  return {
    input: {
      id,
      name,
      title: "clock",
      purpose: "",
      folders: [],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: `create-${id}`,
    compare: {},
    prepared: [],
  };
}

Deno.test("platform/ledger#R8: writer 시각은 core clock을 따라가 event at이 커진다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-clock-" });
  const started = await startCore({
    lophnHome: dir,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    writerClock: "system",
    random: seededRandom(3),
    superviseIo: false,
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    const token = "a".repeat(43);
    const context = {
      principal: "user-1",
      actor: "user" as const,
      credential_ref: "cred_writerclock1",
      scope: { operations: ["project.create", "events/list"], targets: {} },
      conditions: {},
    };
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    const first = await post(
      core,
      "/v1/projects/create",
      project("prj_01arz3ndektsv4rrffq69g5fa1", "alpha"),
      token,
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));

    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await post(
      core,
      "/v1/projects/create",
      project("prj_01arz3ndektsv4rrffq69g5fa2", "beta"),
      token,
    );
    assertEquals(second.status, 200, JSON.stringify(second.body));

    // event 노출 판단과 무관하게 커밋된 `at` 자체를 본다.
    const db = new DatabaseSync(`${core.dataRoot}/lophn.db`, {
      readOnly: true,
    });
    try {
      const rows = db.prepare("select at from events order by seq").all() as {
        at: string;
      }[];
      assert(rows.length >= 2, JSON.stringify(rows));
      const times = rows.map((row) => Date.parse(row.at));
      assert(
        times[times.length - 1] > times[0],
        `event at이 커지지 않는다: ${rows.map((row) => row.at).join(", ")}`,
      );
    } finally {
      db.close();
    }
  } finally {
    await core.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});
