// lophn-agent의 run credential 발급·종료를 platform 인증 경계(CredentialRegistry)에
// 실제로 맞붙인다. platform/ledger#R11, platform/identity#R14: agent credential은 유효
// assignment·run에 묶이고 AgentAppScope를 넓히지 못하며 run 종료·assignment 멈춤·감독 상실에
// 끝난다. 임시 메모리 registry만 쓰고 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import type { AgentAppScope } from "../../packages/protocol/lophn-agent/mod.ts";
import { CredentialRegistry } from "../../packages/core/server/identity/mod.ts";
import { createRunCredentials } from "../../packages/core/lophn-agent/run-loop/mod.ts";

const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const OTHER_ASG = "asg_01arz3ndektsv4rrffq69g5faw";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const OTHER_RUN = "run_01arz3ndektsv4rrffq69g5faw";
const APP = "app_01arz3ndektsv4rrffq69g5fav";

const SCOPE: AgentAppScope = {
  role: "lophn",
  assignment: ASG,
  apps: [{
    app: APP,
    commands: ["list"],
    effects: ["read"],
    revert_required: false,
    confirm_allowed: true,
  }],
};

function registry() {
  const instance = new CredentialRegistry({
    epoch: "core-one",
    clock: manualClock(Date.parse("2026-10-04T00:00:00.000Z")),
    random: seededRandom(7),
    operations: [{ name: "ReadRun", actors: ["agent"], kind: "read" }],
  });
  return { instance };
}

function held(instance: CredentialRegistry) {
  return createRunCredentials({
    issuer: instance,
    operations: ["ReadRun"],
    process: "agent-runtime",
  });
}

Deno.test("platform/ledger#R11: agent credential은 run 하나에 묶여 StartRun의 AgentAppScope를 그대로 싣는다", async () => {
  const { instance } = registry();
  const credentials = held(instance);
  const issued = await credentials.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(issued.ok, issued.ok ? undefined : issued.error.message);
  const context = await instance.authenticate(issued.value.token);
  assert(context.ok);
  assertEquals(context.value.actor, `agent:${ASG}`);
  assertEquals(context.value.conditions.run, RUN);
  assertEquals(context.value.conditions.assignment, ASG);
  assertEquals(context.value.scope.targets, { assignment: ASG, run: RUN });
  assertEquals(context.value.scope.operations, ["ReadRun"]);
  // platform은 scope를 해석하지 않고 그대로 전달한다.
  assertEquals(context.value.scope.agent, SCOPE);
  // 동작은 발급 상한 안이다. 상한 밖 동작은 없다.
  const own = { assignment: ASG, run: RUN };
  assert(instance.authorize(context.value, "ReadRun", own).ok);
  assert(!instance.authorize(context.value, "ApplySettings", own).ok);
  // 다른 run·다른 assignment 대상은 이 credential로 닿지 못한다.
  assert(
    !instance.authorize(context.value, "ReadRun", { ...own, run: OTHER_RUN })
      .ok,
  );
  assert(
    !instance.authorize(context.value, "ReadRun", {
      ...own,
      assignment: OTHER_ASG,
    }).ok,
  );
});

Deno.test("platform/identity#R14: platform은 시작 scope보다 넓은 AgentAppScope를 받지 않는다", async () => {
  // 현재 제한이 좁은 scope를 주면 더 넓은 발급 요청은 거절된다.
  const narrow: AgentAppScope = { ...SCOPE, apps: [] };
  const base = registry();
  const restricted = new CredentialRegistry({
    epoch: "core-one",
    clock: manualClock(Date.parse("2026-10-04T00:00:00.000Z")),
    random: seededRandom(9),
    operations: [{ name: "ReadRun", actors: ["agent"], kind: "read" }],
    current: () =>
      ok({
        scope: {
          operations: ["ReadRun"],
          targets: { assignment: ASG, run: RUN },
          agent: narrow,
        },
        conditions: { assignment: ASG, run: RUN },
      }),
  });
  const refused = await held(restricted).open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(!refused.ok);
  assertEquals(refused.error.code, "invalid_input");
  // 같은 범위는 발급된다.
  const same = await held(restricted).open({
    run: RUN,
    assignment: ASG,
    scope: narrow,
  });
  assert(same.ok);
  // 다른 assignment의 scope는 lophn-agent 쪽에서 막히고 platform도 같은 답이다.
  const crossed = await held(base.instance).open({
    run: RUN,
    assignment: OTHER_ASG,
    scope: SCOPE,
  });
  assert(!crossed.ok);
  assertEquals(crossed.error.code, "forbidden");
});

Deno.test("platform/ledger#R11: run 종료·assignment 멈춤·감독 상실 뒤에는 그 token으로 새 사용이 없다", async () => {
  const { instance } = registry();
  const credentials = held(instance);
  const first = await credentials.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  const second = await credentials.open({
    run: OTHER_RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  const third = await credentials.open({
    run: "run_01arz3ndektsv4rrffq69g5fax",
    assignment: ASG,
    scope: SCOPE,
  });
  assert(first.ok && second.ok && third.ok);
  const usable = async (token: string) =>
    (await instance.authenticate(token)).ok;
  assert(await usable(first.value.token));
  // run 종료는 그 run의 token만 끝낸다.
  credentials.end(RUN);
  assert(!(await usable(first.value.token)));
  assert(await usable(second.value.token));
  // assignment 멈춤은 그 assignment의 나머지를 끝낸다.
  credentials.endAssignment(ASG);
  assert(!(await usable(second.value.token)));
  assert(!(await usable(third.value.token)));
  // 감독 상실: 새로 받은 것도 모두 끝난다.
  const later = await credentials.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(later.ok);
  assert(await usable(later.value.token));
  credentials.endAll();
  assert(!(await usable(later.value.token)));
  assertEquals(credentials.live(), []);
});
