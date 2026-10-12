// connection#R1: lophn 시작·connection 생성·ticket 생성만으로 외부 process가 뜨지 않는다. 시험 중
// `Deno.Command`를 감시해 core 시작(시험 조립)과 사람의 연결 선택·ticket 생성이 어떤 process도
// 만들지 않음을 본다. 사람의 실제 keychain·data root는 열지 않는다(fake keychain, temp LOPHN_HOME).
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import { createFakeKeychain } from "../../packages/core/secrets/mod.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import { startCore } from "./core.ts";
import { ticketDefinitions } from "./tickets.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

async function post(
  port: number,
  path: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
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

Deno.test("coding-agent/connection#R1: core 시작·사람의 연결 선택·ticket 생성만으로 외부 process가 뜨지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-no-spawn-" });
  const spawned: string[] = [];
  const Original = Deno.Command;
  class Spy extends Original {
    constructor(command: string | URL, options?: Deno.CommandOptions) {
      spawned.push(String(command));
      super(command, options);
    }
  }
  Object.defineProperty(Deno, "Command", {
    value: Spy,
    configurable: true,
    writable: true,
  });
  try {
    // 대조: 감시가 실제로 Deno.Command 생성을 잡는다(spawn은 하지 않는다).
    new Deno.Command("true");
    assertEquals(spawned, ["true"]);
    spawned.length = 0;
    const started = await startCore({
      lophnHome: home,
      port: 0,
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
      clock: manualClock(Date.UTC(2026, 9, 5)),
      random: seededRandom(91),
      testCredentials: true,
      superviseIo: false,
      codingKeychain: createFakeKeychain(),
      codingLoaders: ["/opt/lophn/lophn-credential"],
    });
    assert(started.ok, started.ok ? "" : started.error.message);
    await using guard = closeUnlessKept(async () => {
      await started.value.shutdown();
    });
    const core = started.value;
    await core.codingCredentialsReady;
    guard.keep();
    try {
      const user = "U".repeat(43);
      const context: AuthenticatedContext = {
        principal: "user",
        actor: "user",
        scope: {
          operations: [
            "app.create",
            "ConnectCodingAgent",
            "CreateCodingAgentConnection",
            "CreateTicket",
          ],
          targets: {},
        },
        conditions: {},
        credential_ref: `cred-user-${core.epoch}`,
      };
      assert(core.acceptTestCredential);
      assert((await core.acceptTestCredential(context, user)).ok);
      assert((await core.record(context)).ok);
      const app = await post(core.port, "apps/create", user, {
        input: { slug: "notes", name: "Notes", description: "notes app" },
        idempotency_key: "app-1",
        compare: {},
        prepared: [],
      });
      assertEquals(app.status, 200, JSON.stringify(app.body));
      const connected = await post(
        core.port,
        "coding_agent_connections/connect",
        user,
        { label: "claude", scope: { kind: "all", app: null } },
      );
      assertEquals(connected.status, 200, JSON.stringify(connected.body));
      const created = await post(core.port, "tickets/create", user, {
        input: {
          app: (app.body as { id?: string }).id,
          kind: "implementation",
          title: "fix leaf redaction",
          what: "redact leaf before snapshot",
          why: "snapshot shows the raw leaf",
          references: [],
          adoption_questions: [],
          conditions: [],
          inspect: ["src/leaf.ts"],
          preserve: ["docs/leaf.md"],
          problems: [],
          readiness: "needs_confirmation",
          needs: ["confirm the redaction"],
        },
        idempotency_key: "ticket-1",
        compare: {},
        prepared: [],
      });
      assertEquals(created.status, 200, JSON.stringify(created.body));
      // 시작·연결 선택·ticket 생성 어디서도 외부 process(harness·shell·helper)를 만들지 않았다.
      assertEquals(spawned, []);
    } finally {
      await core.shutdown();
    }
  } finally {
    Object.defineProperty(Deno, "Command", {
      value: Original,
      configurable: true,
      writable: true,
    });
    await Deno.remove(home, { recursive: true });
  }
});
