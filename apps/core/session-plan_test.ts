// 실제 core(임시 LOPHN_HOME)의 준비된 ticket으로 시작 계획을 만든다(coding-agent#T38, sessions#R1·R2·R3·R4).
// shell main이 하는 순서 그대로다: user 자격으로 ticket 상세와 연결을 읽어 사실(facts)로 넘기고 `lophn session
// plan`이 PATH의 fake harness를 감지해 plan을 낸다. harness는 PATH fixture(tools/fake-coding-agent를 감싼
// 파일)이고 감지만 하며 실행하지 않는다. 사람의 실제 home·data root·keychain·harness 설정은 열지 않는다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { codingAgentLaunchPlanSchema } from "../../packages/protocol/coding-agent/mod.ts";
import { createFakeKeychain } from "../../packages/platform/secrets/mod.ts";
import { cliMain } from "../cli/main.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import { ticketDefinitions } from "./tickets.ts";
import { createCoreHarness } from "./testing/core.ts";

const START = Date.parse("2026-10-07T00:00:00.000Z");
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const READY = "tkt_01arz3ndektsv4rrffq69g5fa2";
const WORKING = "tkt_01arz3ndektsv4rrffq69g5fa3";
const NEEDS = "tkt_01arz3ndektsv4rrffq69g5fa1";
const OTHER_CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const FAKE_AGENT = new URL(
  "../../tools/fake-coding-agent/mod.ts",
  import.meta.url,
).pathname;

type Reply = { status: number; body: Record<string, unknown> };

async function call(
  port: number,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function seed(dataRoot: string, app: string): void {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const ticket = db.prepare(
      `INSERT INTO tickets (id, app, kind, title, what, why, inspect, preserve, problems,
         state, readiness, needs, cancel_reason, completion_seq, revision)
       VALUES (?, ?, 'implementation', ?, 'what', 'why', '["src/a.ts"]', '[]', '[]',
         ?, ?, ?, NULL, NULL, '5')`,
    );
    ticket.run(READY, app, "ready", "open", "ready", "[]");
    ticket.run(WORKING, app, "working", "claimed", "ready", "[]");
    ticket.run(
      NEEDS,
      app,
      "needs",
      "open",
      "needs_confirmation",
      '["confirm the redaction"]',
    );
    db.prepare(
      `INSERT INTO ticket_claims (ticket, connection, claim_seq, expires_at)
       VALUES (?, ?, '7', '2026-10-07T01:00:00.000Z')`,
    ).run(WORKING, OTHER_CAC);
  } finally {
    db.close();
  }
}

async function run(
  args: string[],
  env: Record<string, string>,
  home: string,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const out = new TransformStream<Uint8Array, Uint8Array>();
  const errs = new TransformStream<Uint8Array, Uint8Array>();
  const decoder = new TextDecoder();
  const collect = async (readable: ReadableStream<Uint8Array>) => {
    let text = "";
    for await (const chunk of readable) {
      text += decoder.decode(chunk, { stream: true });
    }
    return text;
  };
  const stdout = collect(out.readable);
  const stderr = collect(errs.readable);
  const exit = await cliMain(args, {
    stdout: out.writable,
    stderr: errs.writable,
    cwd: home,
    home,
    installRoot: "/nonexistent-install",
    env: { get: (name: string) => env[name] },
  });
  await out.writable.close();
  await errs.writable.close();
  return { exit, stdout: await stdout, stderr: await stderr };
}

Deno.test("coding-agent/sessions#R1 coding-agent/sessions#R2 coding-agent/sessions#R3 coding-agent/sessions#R4: 실제 core의 준비된 ticket과 PATH의 fake harness로 plan을 만들고 이미 claim된·확인 필요 ticket은 plan 없이 끝난다", async () => {
  const keychain = createFakeKeychain();
  const harness = await createCoreHarness({
    nowMs: START,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { codingAgentConnectionDefinitions },
      { ticketDefinitions },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
      new URL("./coding-agent.ts", import.meta.url).href,
      new URL("./tickets.ts", import.meta.url).href,
    ],
    coding: { keychain, loaders: [] },
  });
  assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
  const core = harness.value;
  const base = await Deno.makeTempDir({ prefix: "lophn-session-plan-" });
  try {
    await core.codingCredentialsReady;
    const credential = await core.credential({
      actor: "user",
      principal: "user-1",
      scope: {
        operations: [
          "app.create",
          "CreateCodingAgentConnection",
          "ShowCodingAgentConnection",
          "ShowTicketScreen",
        ],
        targets: {},
      },
      conditions: {},
    });
    assert(credential.ok);
    const user = credential.value.token;
    const created = await call(core.port, "apps/create", user, {
      input: { slug: "notes", name: "notes", description: "notes app" },
      idempotency_key: `k-${crypto.randomUUID()}`,
      compare: {},
      prepared: [],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = String(created.body["id"]);
    seed(core.dataRoot, app);
    const connected = await core.codingCredentials!.connect(
      { label: "claude", scope: { kind: "app", app } },
      async (submission): Promise<Result<unknown>> => {
        const sent = await call(
          core.port,
          "coding_agent_connections/create",
          user,
          {
            input: submission,
            idempotency_key: `k-${crypto.randomUUID()}`,
            compare: {},
            prepared: [],
          },
        );
        return sent.status === 200
          ? ok(sent.body)
          : err({ code: "conflict", message: `${sent.status}` });
      },
    );
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    const connection = connected.value.connection;

    // PATH fixture: 실행 파일이지만 plan은 감지만 하고 띄우지 않는다.
    await Deno.mkdir(`${base}/bin`, { recursive: true });
    await Deno.writeTextFile(
      `${base}/bin/claude`,
      `#!/bin/sh\nexec deno run ${FAKE_AGENT} "$@"\n`,
    );
    await Deno.chmod(`${base}/bin/claude`, 0o755);
    const env = {
      LOPHN_HOME: `${base}/lophn-home`,
      PATH: `${base}/bin`,
      HOME: base,
    };

    // shell main이 하는 일: user 자격으로 ticket 상세와 연결을 다시 읽어 사실로 만든다.
    const factsOf = async (ticket: string) => {
      const detail = await call(core.port, "tickets/screen_detail", user, {
        ticket,
      });
      assertEquals(detail.status, 200, JSON.stringify(detail.body));
      const shown = await call(
        core.port,
        "coding_agent_connections/show",
        user,
        { connection },
      );
      assertEquals(shown.status, 200, JSON.stringify(shown.body));
      const t = detail.body["ticket"] as Record<string, unknown>;
      const c = shown.body["connection"] as Record<string, unknown>;
      return {
        revision: String(t["revision"]),
        facts: {
          ticket_app: t["app"],
          screen_state: t["screen_state"],
          connection_state: c["state"],
          connection_scope: c["scope"],
          problems: t["problems"],
          inspect: t["inspect"],
        },
      };
    };
    const planArgs = (
      ticket: string,
      read: Awaited<ReturnType<typeof factsOf>>,
    ) => [
      "session",
      "plan",
      "--json",
      "--input",
      JSON.stringify({
        plan_input: {
          ticket,
          ticket_revision: read.revision,
          connection,
          harness_id: "claude",
          project: PRJ,
          folder_ref: "src",
          cwd: base,
          method: "terminal_tui",
          facts: read.facts,
          human_start_handle: "hs_real",
          operation_id: "op_real",
        },
      }),
    ];

    const ready = await factsOf(READY);
    assertEquals(ready.facts.screen_state, "ready");
    const planned = await run(planArgs(READY, ready), env, base);
    assertEquals(planned.exit, 0, planned.stdout + planned.stderr);
    const plan = codingAgentLaunchPlanSchema.parse(
      JSON.parse(planned.stdout).data.plan,
    );
    assertEquals(plan.ticket, READY);
    assertEquals(plan.ticket_revision, ready.revision);
    assertEquals(plan.connection, connection);
    assertEquals(plan.executable, `${base}/bin/claude`);
    assertEquals(plan.cwd, base);
    assertEquals(plan.prompt_delivery, { mode: "argv" });
    assertEquals(plan.argv, ["claude", plan.first_prompt]);
    assertEquals(plan.env_overlay?.["LOPHN_CONNECTION"], connection);
    assert(plan.first_prompt.includes(READY));
    assert(plan.first_prompt.includes("src/a.ts"));
    // token·본문은 prompt와 plan 어디에도 없다.
    const issued = new TextDecoder().decode(
      [...keychain.stored.values()][0],
    );
    assertFalse(planned.stdout.includes(issued));
    assertFalse(plan.first_prompt.includes("what"));

    // 이미 claim된 ticket과 확인이 필요한 ticket은 plan 없이 conflict다.
    for (const ticket of [WORKING, NEEDS]) {
      const read = await factsOf(ticket);
      const refused = await run(planArgs(ticket, read), env, base);
      assert(refused.exit !== 0, ticket);
      const text = refused.stdout + refused.stderr;
      assert(text.includes("conflict"), text);
      assertFalse(text.includes("human_start_handle"), text);
    }
  } finally {
    await core.close();
    await Deno.remove(base, { recursive: true });
  }
});
