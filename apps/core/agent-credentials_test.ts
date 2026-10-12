// lophn-agent/harness/run-loop: agent runtime 감독 pipe의 agent credential 발급을 실제 core(임시
// LOPHN_HOME, 실제 ledger)의 run·assignment·RunStarted 기록으로 확인한다. child가 보낸 operation·scope를
// 믿지 않고 core 기록과 대조한다. 실제 provider와 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AgentAppScope } from "../../packages/protocol/lophn-agent/mod.ts";
import type { ChildMessage } from "../../packages/protocol/platform/mod.ts";
import { CredentialRegistry } from "../../packages/core/server/identity/mod.ts";
import {
  createAgentCredentialLink,
  roleOperations,
} from "./agent-credentials.ts";
import {
  acceptCredential,
  context,
  openWaitingWorld,
  type WaitingWorld,
} from "./testing/waiting-world.ts";
import { coreCall, USER_TOKEN } from "./testing/tool-judgment-world.ts";

const READER_TOKEN = "r".repeat(43);

async function setup() {
  const world = await openWaitingWorld();
  await acceptCredential(
    world.core,
    context(
      "machine",
      ["ReadRun", "ReadAssignment", "ListEvents"],
      {},
      "reader",
    ),
    READER_TOKEN,
  );
  const allowed = roleOperations("lophn");
  const registry = new CredentialRegistry({
    epoch: "core-one",
    clock: manualClock(Date.parse("2026-10-06T00:00:00.000Z")),
    random: seededRandom(5),
    operations: [...new Set([...allowed, "ApplySettings"])].map((name) => ({
      name,
      actors: ["agent" as const],
      kind: "read" as const,
    })),
  });
  const link = createAgentCredentialLink({
    issuer: registry,
    machine: coreCall(world.server, READER_TOKEN),
    process: "agent-runtime",
  });
  return { world, registry, link, allowed };
}

function request(
  world: WaitingWorld,
  over: Record<string, unknown> = {},
): ChildMessage {
  const scope: AgentAppScope = {
    role: "lophn",
    assignment: world.lophn.assignment.id,
    apps: [],
  };
  return {
    type: "agent_credential_request",
    request_id: "r1",
    run: world.lophn.run,
    assignment: world.lophn.assignment.id,
    operations: [],
    scope,
    ...over,
  } as ChildMessage;
}

Deno.test("lophn-agent/harness/run-loop#R15: 진행 중인 run의 요청은 core 기록과 같은 scope·역할 상한 안 operation으로 발급되고 token은 run 하나에 묶인다", async () => {
  const { world, registry, link, allowed } = await setup();
  try {
    const operations = allowed.slice(0, 2);
    const response = await link.onMessage(request(world, { operations }));
    assert(response !== undefined);
    assertEquals(response.request_id, "r1");
    const authenticated = await registry.authenticate(response.credential);
    assert(authenticated.ok);
    assertEquals(
      authenticated.value.actor,
      `agent:${world.lophn.assignment.id}`,
    );
    assertEquals(authenticated.value.conditions.run, world.lophn.run);
    assertEquals(authenticated.value.conditions.process, "agent-runtime");
    assertEquals(authenticated.value.scope.operations, operations);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/run-loop#R15: 없는 run·끝난 run·다른 assignment의 run은 모두 같은 거절이다", async () => {
  const { world, link, allowed } = await setup();
  try {
    const operations = allowed.slice(0, 1);
    // 없는 run.
    assertEquals(
      await link.onMessage(
        request(world, { run: "run_01arz3ndektsv4rrffq69g5faz", operations }),
      ),
      undefined,
    );
    // 다른 assignment의 run: 요청이 assignment를 바꿔 써도 core 기록과 어긋난다.
    assertEquals(
      await link.onMessage(
        request(world, { assignment: world.editor.assignment.id, operations }),
      ),
      undefined,
    );
    // 끝난 run. 사람이 멈춘 run은 credential을 받지 못한다.
    const read = await world.read("runs/read", USER_TOKEN, {
      run: world.lophn.run,
    });
    const stateSeq =
      (read.body as { run: { state_seq: string } }).run.state_seq;
    const stopped = await world.post(
      "runs/stop",
      USER_TOKEN,
      { run: world.lophn.run, request_key: "stop-1", reason: "user_stopped" },
      { state_seq: stateSeq },
    );
    assertEquals(stopped.status, 200, JSON.stringify(stopped.body));
    assertEquals(
      await link.onMessage(request(world, { operations })),
      undefined,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/run-loop#R15: StartRun이 확정한 scope보다 넓은 scope와 역할 상한 밖 operation은 발급하지 않는다", async () => {
  const { world, link, allowed } = await setup();
  try {
    const operations = allowed.slice(0, 1);
    const wider = {
      role: "lophn",
      assignment: world.lophn.assignment.id,
      apps: [{
        app: "app_01arz3ndektsv4rrffq69g5fav",
        commands: ["list"],
        effects: ["read"],
        revert_required: false,
        confirm_allowed: true,
      }],
    };
    assertEquals(
      await link.onMessage(request(world, { operations, scope: wider })),
      undefined,
    );
    // 다른 역할로 써 보낸 scope.
    assertEquals(
      await link.onMessage(
        request(world, {
          operations,
          scope: {
            role: "operator",
            assignment: world.lophn.assignment.id,
            apps: [],
          },
        }),
      ),
      undefined,
    );
    // 역할 상한 밖 operation은 발급 정책이 허용하는 이름이어도 거절한다.
    assertEquals(
      await link.onMessage(
        request(world, { operations: [...operations, "ApplySettings"] }),
      ),
      undefined,
    );
    assertEquals(allowed.includes("ApplySettings"), false);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/run-loop#R15: agent_credential_end는 그 run의 credential을 끝낸다", async () => {
  const { world, registry, link, allowed } = await setup();
  try {
    const response = await link.onMessage(
      request(world, { operations: allowed.slice(0, 1) }),
    );
    assert(response !== undefined);
    assert((await registry.authenticate(response.credential)).ok);
    assertEquals(
      await link.onMessage({
        type: "agent_credential_end",
        run: world.lophn.run,
      }),
      undefined,
    );
    assert(!(await registry.authenticate(response.credential)).ok);
  } finally {
    await world.dispose();
  }
});
