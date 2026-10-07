// lophn-agent/harness/provider#R29, R30, R27: 명시 연결 test route가 실제 core에서 닿는다.
// 실제 core(temp home, 실제 ledger)에서 settings 조회(read·list)만으로는 연결 test
// engine이 model call을 보내지 않고, 사용량 대기 credential은 보내지 않고 결과 없음으로
// 답하며, 성공 path는 fake provider로 보내고 호출 기록의 청구액은 확정되지 않은 것으로
// 남는다(0이 아니다). 실제 provider·사람 data root·OS keychain은 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import {
  CONNECTION_TEST_TIMEOUT_MS,
  registerProviderCredential,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { confirmationBinding } from "../../packages/platform/identity/mod.ts";
import {
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "./documents.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { call, command } from "./testing/approvals-fixture.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";
import { inProcessIo } from "./testing/in-process-io.ts";
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import type { Step } from "../../tools/fake-provider/mod.ts";

const AT = Date.UTC(2024, 0, 1);
const TOKEN = "e".repeat(43);
const MACHINE_TOKEN = "f".repeat(43);
const PVD = "pvd_01arz3ndektsv4rrffq69g5fav";
const API_KEY = "sk-fake-connection-test-value";
const MODEL = "claude-sonnet-4-5";
const OPERATIONS = [
  "RegisterProvider",
  "RegisterProviderCredential",
  "RecordProviderAvailability",
  "RecordProviderCheck",
  "ReadProvider",
  "ListProviders",
  "ListProviderCredentials",
  "TestProviderConnection",
];

// 상태 기록(availability)은 machine route다(platform#R7). machine 자격의 scope다.
const MACHINE_OPERATIONS = [
  "RecordProviderAvailability",
  "RecordProviderCheck",
  "StartModelCall",
  "FinishModelCall",
  "secret.send",
];

const ANTHROPIC = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["api_key"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

type Opened = {
  core: Core;
  server: { port: number; dataRoot: string };
  home: string;
  keychain: FakeKeychain;
  machineToken: string;
};

// agent-runtime-child_test.ts와 같은 boot다. 값이 닿는 곳은 fake keychain뿐이다.
async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-provider-test-" });
  const keychain = createFakeKeychain();
  const io = inProcessIo({ root: home });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(21),
    testCredentials: true,
    secretKeychain: keychain,
    spawn: io.spawn,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
  });
  const core = started.value;
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-provider-test",
  };
  assert((await core.acceptTestCredential?.(context, TOKEN))?.ok);
  assert((await core.record(context)).ok);
  // 상태 기록(availability)은 machine route다. 사용량 대기 시험을 위해 machine
  // 자격을 토큰에 심는다.
  const machine: AuthenticatedContext = {
    principal: "machine-1",
    actor: "machine",
    scope: { operations: MACHINE_OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-provider-test-machine",
  };
  assert((await core.acceptTestCredential?.(machine, MACHINE_TOKEN))?.ok);
  assert((await core.record(machine)).ok);
  guard.keep();
  return {
    core,
    server: { port: core.port, dataRoot: core.dataRoot },
    home,
    keychain,
    machineToken: MACHINE_TOKEN,
  };
}

async function close(opened: Opened): Promise<void> {
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
}

// 사람이 API key provider를 등록한다: 값은 keychain에 있고 ledger에는 준비 증거와
// 참조만 남는다(agent-runtime-child_test.ts와 같은 길).
async function registerProvider(
  opened: Opened,
  endpoint: string,
): Promise<number> {
  const registered = await call(
    opened.server,
    "providers/register",
    TOKEN,
    command({
      id: PVD,
      name: "Fixture",
      definition: ANTHROPIC,
      endpoint,
      protocol: "anthropic-messages",
    }),
  );
  assertEquals(registered.status, 200, JSON.stringify(registered.body));
  const revision = (registered.body["provider"] as { revision: number })
    .revision;
  const stored = await opened.keychain.store({
    name: `${PVD}/main`,
    purpose: "provider_credential",
    owner: PVD,
    value: new TextEncoder().encode(API_KEY),
  });
  assert(stored.ok);
  const preparation = `prep-${crypto.randomUUID()}`;
  const db = new DatabaseSync(`${opened.home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      "INSERT INTO secret_preparations (preparation, sealed_ref, purpose, owner) VALUES (?, ?, 'provider_credential', ?)",
    ).run(preparation, stored.value, PVD);
  } finally {
    db.close();
  }
  const input = {
    provider: PVD,
    key: "main",
    kind: "api_key",
    label: "main key",
    preparation: {
      preparation,
      sealed_ref: stored.value,
      purpose: "provider_credential",
      owner: PVD,
    },
    account: null,
    organization: null,
    plan: null,
    dedup_fingerprint: "a".repeat(64),
  };
  const binding = await confirmationBinding(registerProviderCredential, input);
  assert(binding);
  const issued = await opened.core.confirmation?.({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${crypto.randomUUID()}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [registerProviderCredential.name],
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    },
  });
  assert(issued?.ok, JSON.stringify(issued));
  const handle = (issued.value as { confirmation: string }).confirmation;
  const added = await call(
    opened.server,
    "provider-credentials/register",
    TOKEN,
    command(input, { compare: { revision }, confirmation: handle }),
  );
  assertEquals(added.status, 200, JSON.stringify(added.body));
  return revision;
}

// 사용량 대기 상태로 넣는다. 상태 변경은 machine route(RecordProviderAvailability)다.
async function waitForUsage(opened: Opened, until: string): Promise<void> {
  const read = await call(opened.server, "providers/read", TOKEN, {
    provider: PVD,
  });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  const provider = read.body["provider"] as { revision: number };
  const changed = await call(
    opened.server,
    "provider-credentials/record-availability",
    opened.machineToken,
    command({
      provider: PVD,
      key: "main",
      state: "usage_wait",
      unavailable_reason: "quota",
      until,
      model_block: null,
    }, { compare: { revision: provider.revision } }),
  );
  assertEquals(changed.status, 200, JSON.stringify(changed.body));
}

function answer(text: string): Step {
  return {
    id: `answer-${text.replace(/\W+/g, "-")}`,
    protocol: "messages",
    reply: { text, usage: { input: 1, output: 1 }, stop: "end" as const },
  };
}

Deno.test("lophn-agent/harness/provider#R29: 설정 조회(read·list)만으로는 연결 test engine이 model call을 보내지 않는다", async () => {
  const fake = startFakeProvider({
    script: { steps: [] },
    nowMs: () => Date.now(),
    instant: true,
  });
  const opened = await open();
  try {
    await registerProvider(opened, fake.url);
    // 등록 뒤 설정 조회만 부른다. test route는 부르지 않는다.
    const read = await call(opened.server, "providers/read", TOKEN, {
      provider: PVD,
    });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const list = await call(opened.server, "providers/list", TOKEN, {});
    assertEquals(list.status, 200, JSON.stringify(list.body));
    const definitions = await call(
      opened.server,
      "providers/definitions",
      TOKEN,
      {},
    );
    assertEquals(definitions.status, 200, JSON.stringify(definitions.body));
    // fake provider에 요청이 가지 않는다. 조회만으로는 test 시도가 없다(R29).
    assertEquals(fake.requests().length, 0);
  } finally {
    await close(opened);
    await fake.close();
  }
});

Deno.test("lophn-agent/harness/provider#R30: 사용량 대기 credential의 명시 test는 보내지 않고 결과 없음으로 답한다", async () => {
  const fake = startFakeProvider({
    script: { steps: [] },
    nowMs: () => Date.now(),
    instant: true,
  });
  const opened = await open();
  try {
    await registerProvider(opened, fake.url);
    // reset 시각을 아직 오지 않은 미래로 둔다(R30).
    await waitForUsage(opened, new Date(Date.now() + 3_600_000).toISOString());
    const checked = await call(
      opened.server,
      "providers/test",
      TOKEN,
      command({
        provider: PVD,
        credential_key: "main",
        model_name: MODEL,
        test_kind: "text",
        command_key: "test-wait-1",
      }),
    );
    assertEquals(checked.status, 200, JSON.stringify(checked.body));
    // 결과 없음: 보내지 않았다(R30). 시간 상한은 고정 30초다.
    assertEquals(checked.body["check"], null);
    assertEquals(checked.body["timeout_ms"], CONNECTION_TEST_TIMEOUT_MS);
    // fake provider에 요청이 가지 않는다.
    assertEquals(fake.requests().length, 0);
    // credential 상태는 usage_wait로 남는다.
    const reads = await call(
      opened.server,
      "provider-credentials/list",
      TOKEN,
      { provider: PVD },
    );
    assertEquals(reads.status, 200, JSON.stringify(reads.body));
    const credentials = reads.body["credentials"] as Array<{ state: string }>;
    assertEquals(credentials[0]!.state, "usage_wait");
  } finally {
    await close(opened);
    await fake.close();
  }
});

Deno.test("lophn-agent/harness/provider#R30, R27: 명시 test는 고정 재료만 한 번 보내고 30초 상한이며 확정되지 않은 청구액은 모름이다", async () => {
  const fake = startFakeProvider({
    script: { steps: [answer("ok")] },
    nowMs: () => Date.now(),
    instant: true,
  });
  const opened = await open();
  try {
    await registerProvider(opened, fake.url);
    const checked = await call(
      opened.server,
      "providers/test",
      TOKEN,
      command({
        provider: PVD,
        credential_key: "main",
        model_name: MODEL,
        test_kind: "text",
        command_key: "test-ok-1",
      }),
    );
    assertEquals(checked.status, 200, JSON.stringify(checked.body));
    const check = checked.body["check"] as {
      at: string;
      credential_key: string;
      credential_revision: number;
      model_name: string;
      test_kind: "text" | "tool_call";
      command_key: string;
      calls: string[];
      result: "success" | "failure";
      code: string | null;
    } | null;
    assert(check !== null, JSON.stringify(checked.body));
    // fake provider가 성공으로 답했다. 재료는 고정 문구뿐이다(R29).
    assertEquals(check.result, "success");
    assertEquals(check.code, null);
    assertEquals(check.credential_key, "main");
    assertEquals(check.model_name, MODEL);
    assertEquals(check.calls.length, 1);
    assertEquals(checked.body["timeout_ms"], CONNECTION_TEST_TIMEOUT_MS);
    assertEquals(fake.requests().length, 1);
    // 재료는 고정 문구뿐이다. 세션·문서·사용자 입력이 없다(R29).
    const sent = JSON.stringify(fake.requests()[0].body);
    assert(sent.includes("Reply with the single word: ok"));
    // 마지막 check는 provider 기록에 남는다.
    const reads = await call(opened.server, "providers/read", TOKEN, {
      provider: PVD,
    });
    assertEquals(reads.status, 200, JSON.stringify(reads.body));
    const provider = reads.body["provider"] as {
      last_check: { result: string } | null;
    };
    assertEquals(provider.last_check?.result, "success");
  } finally {
    await close(opened);
    await fake.close();
  }
});
