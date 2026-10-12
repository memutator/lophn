import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/platform/mod.ts";
import type { AgentAppScope } from "../../../protocol/lophn-agent/mod.ts";
import {
  type AgentCredentialScope,
  authorize,
  type CredentialIssue,
  CredentialRegistry,
  intersectScope,
} from "./mod.ts";
import { code, fixture, POLICIES, value } from "./fixtures_test.ts";

const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const OTHER_ASG = "asg_01arz3ndektsv4rrffq69g5faw";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const OTHER_RUN = "run_01arz3ndektsv4rrffq69g5faw";
const APP = "app_01arz3ndektsv4rrffq69g5fav";

const agentScope: AgentAppScope = {
  role: "lophn",
  assignment: ASG,
  apps: [{
    app: APP,
    commands: ["status"],
    effects: ["read"],
    revert_required: false,
    confirm_allowed: false,
  }],
};

const widerScope: AgentAppScope = {
  ...agentScope,
  apps: [{ ...agentScope.apps[0], effects: ["read", "write"] }],
};

function agentIssue(scope: AgentAppScope = agentScope): CredentialIssue {
  return {
    actor: `agent:${ASG}`,
    principal: `agent:${ASG}`,
    scope: {
      operations: ["identity/current"],
      targets: { assignment: ASG, run: RUN },
      agent: scope,
    },
    conditions: { assignment: ASG, run: RUN, process: "agent-runtime" },
  };
}

function registryWith(
  currentScope: AgentCredentialScope,
  conditions: { assignment?: string; run?: string } = {
    assignment: ASG,
    run: RUN,
  },
  active = true,
) {
  const base = fixture();
  const registry = new CredentialRegistry({
    epoch: "core-one",
    clock: base.clock,
    random: base.random,
    operations: POLICIES,
    current: () =>
      active
        ? ok({ scope: currentScope, conditions })
        : err({ code: "forbidden", message: "run ended" }),
  });
  return { registry };
}

Deno.test("platform/identity#R14 platform/ledger#R11: agent credential은 유효 assignment·run에 묶이고 AgentAppScope 상한을 넓히지 못한다", async () => {
  const { registry } = registryWith(agentIssue().scope);
  const issued = value(await registry.issue(agentIssue()));
  const ctx = value(await registry.authenticate(issued.token));
  assertEquals(ctx.actor, `agent:${ASG}`);
  assertEquals(ctx.conditions.run, RUN);
  assertEquals(ctx.scope.agent, agentScope);

  // agent runtime 자체는 machine credential이다. agent scope를 실을 수 없다.
  const runtime = fixture().registry;
  assertEquals(
    code(
      await runtime.issue({
        actor: "machine",
        principal: "agent-runtime",
        scope: {
          operations: ["task/result"],
          targets: { task: "runtime" },
          agent: agentScope,
        },
        conditions: { task: "runtime", process: "agent-runtime" },
      }),
    ),
    "invalid_input",
  );

  // 다른 assignment·다른 run·상한을 넘는 scope·run 없는 발급은 거절한다.
  for (
    const forged of [
      agentIssue({ ...agentScope, assignment: OTHER_ASG }),
      {
        ...agentIssue(),
        conditions: { assignment: ASG, process: "agent-runtime" },
      },
      {
        ...agentIssue(),
        scope: {
          ...agentIssue().scope,
          targets: { assignment: ASG, run: OTHER_RUN },
        },
      },
      agentIssue(widerScope),
    ]
  ) {
    assertEquals(
      code(await registry.issue(forged as CredentialIssue)),
      "invalid_input",
      JSON.stringify(forged.conditions),
    );
  }
});

Deno.test("platform/identity#R14: 앱 하나에 묶인 agent는 앱 조건과 handoff 고정 근거를 싣고 발급받으며 대상은 앱으로 고정되지 않는다", async () => {
  const evidence = [{
    document: "doc_01arz3ndektsv4rrffq69g5fav",
    version: "ver_01arz3ndektsv4rrffq69g5fav",
  }];
  const issue = agentIssue({ ...agentScope, role: "app_engineer" });
  const bound: CredentialIssue = {
    ...issue,
    conditions: { ...issue.conditions, app: APP, evidence },
  };
  const { registry } = registryWith(bound.scope);
  const issued = value(await registry.issue(bound));
  const ctx = value(await registry.authenticate(issued.token));
  assertEquals(ctx.conditions.app, APP);
  assertEquals(ctx.conditions.evidence, evidence);
  assertEquals(ctx.scope.targets, { assignment: ASG, run: RUN });
});

Deno.test("platform/ledger#R11: run 종료·assignment 멈춤·감독 상실은 agent credential을 끝낸다", async () => {
  const { registry } = registryWith(agentIssue().scope);
  const issued = value(await registry.issue(agentIssue()));
  const ctx = value(await registry.authenticate(issued.token));

  // 현재 제한이 시작 scope보다 넓어져도 인증된 scope는 시작 상한을 넘지 않는다.
  const { registry: widened } = registryWith({
    operations: ["identity/current", "approval/decide"],
    targets: { assignment: ASG, run: RUN },
    agent: agentScope,
  });
  const widenedIssued = value(await widened.issue(agentIssue()));
  const widenedCtx = value(await widened.authenticate(widenedIssued.token));
  assertEquals(widenedCtx.scope.agent, agentScope);
  assertEquals(widenedCtx.scope.operations, ["identity/current"]);

  // 현재 제한이 다른 AgentAppScope를 주면 발급 자체가 거절된다. 상한을 넓히지 않는다.
  const { registry: replaced } = registryWith({
    operations: ["identity/current"],
    targets: { assignment: ASG, run: RUN },
    agent: { ...agentScope, apps: [] },
  });
  assertEquals(code(await replaced.issue(agentIssue())), "invalid_input");

  // 감독 상실(현재 조건 실패)과 run 종료는 새 사용을 막는다. 발급은 이미 된 상태다.
  const lostActive = { value: true };
  const lostBase = fixture();
  const lost = new CredentialRegistry({
    epoch: "core-one",
    clock: lostBase.clock,
    random: lostBase.random,
    operations: POLICIES,
    current: () =>
      ok({
        scope: agentIssue().scope,
        conditions: { assignment: ASG, run: RUN },
      }),
    live: () =>
      lostActive.value
        ? ok({
          scope: agentIssue().scope,
          conditions: { assignment: ASG, run: RUN },
        })
        : err({ code: "forbidden", message: "run ended" }),
  });
  const lostIssued = value(await lost.issue(agentIssue()));
  lostActive.value = false;
  assertEquals(code(await lost.authenticate(lostIssued.token)), "unauthorized");
  assertEquals(registry.endBy("run", RUN), 1);
  assertEquals(code(registry.revalidate(ctx)), "unauthorized");
  const { registry: paused } = registryWith(agentIssue().scope);
  const pausedIssued = value(await paused.issue(agentIssue()));
  assertEquals(paused.endBy("assignment", ASG), 1);
  assertEquals(
    code(paused.revalidate({ credential_ref: pausedIssued.credential_ref })),
    "unauthorized",
  );
});

Deno.test("platform/ledger#R11: agent scope는 apps 연결 검사로 전달되고 상한을 넘는 대상은 거절한다", () => {
  const ctx: AuthenticatedContext = {
    actor: `agent:${ASG}`,
    principal: `agent:${ASG}`,
    credential_ref: "ref",
    scope: agentIssue().scope,
    conditions: { assignment: ASG, run: RUN },
  };
  // 자격에 묶인 run·assignment만 통과한다. 내용은 apps 연결 검사가 그대로 받는다.
  assert(authorize(ctx, "identity/current", { assignment: ASG, run: RUN }).ok);
  assertEquals(
    code(
      authorize(ctx, "identity/current", { assignment: ASG, run: OTHER_RUN }),
    ),
    "forbidden",
  );
  assertEquals(
    code(
      authorize(ctx, "identity/current", { assignment: OTHER_ASG, run: RUN }),
    ),
    "forbidden",
  );
  // 같은 상한은 그대로 남고, 현재 제한이 넓혀도 시작 상한을 넘지 않는다.
  assertEquals(
    intersectScope(ctx.scope, {
      operations: ["identity/current"],
      targets: { assignment: ASG, run: RUN },
      agent: agentScope,
    }).agent,
    agentScope,
  );
  assertEquals(
    intersectScope(ctx.scope, {
      operations: ["identity/current"],
      targets: { assignment: ASG, run: RUN },
      agent: widerScope,
    }).agent,
    agentScope,
  );
  // 현재 제한이 좁히면 교집합만 남는다. 상한을 통째로 버리지 않는다.
  const narrowed = intersectScope(ctx.scope, {
    operations: ["identity/current"],
    targets: { assignment: ASG, run: RUN },
    agent: {
      ...agentScope,
      apps: [{ ...agentScope.apps[0], commands: [] }],
    },
  });
  assertEquals(narrowed.agent?.apps, []);
  assertEquals(narrowed.operations, ["identity/current"]);
  // role이 다르면 교집합이 없고 동작도 남지 않는다.
  const foreign = intersectScope(ctx.scope, {
    operations: ["identity/current"],
    targets: { assignment: ASG, run: RUN },
    agent: { ...agentScope, role: "operator" },
  });
  assertEquals(foreign.agent, undefined);
  assertEquals(foreign.operations, []);
});
