import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { AgentAppScope } from "../../../protocol/lophn-agent/mod.ts";
import {
  type AgentCredentialIssuer,
  beginRun,
  createRunCredentials,
} from "./credentials.ts";
import { runId } from "./testing/runs.ts";

// run마다 agent credential을 받고 끝내는 호출 순서 테스트. 발급 경계는 platform의 것이라
// 여기서는 그 port의 기록용 대역을 쓴다. 실제 인증 경계와 맞붙인 확인은
// packages/core/lophn-agent/run-loop/run-credentials_test.ts에 있다.

const ASG = runId("asg", 1);
const OTHER_ASG = runId("asg", 2);
const RUN = runId("run", 1);
const OTHER_RUN = runId("run", 2);

const SCOPE: AgentAppScope = { role: "lophn", assignment: ASG, apps: [] };

type Issued = Parameters<AgentCredentialIssuer["issue"]>[0];

function recordingIssuer(options: { fail?: boolean } = {}) {
  const issued: Issued[] = [];
  const ended: [string, string][] = [];
  let counter = 0;
  const issuer: AgentCredentialIssuer = {
    issue(input) {
      issued.push(input);
      if (options.fail) {
        return Promise.resolve(
          err({ code: "unavailable", message: "no credential" }),
        );
      }
      counter++;
      return Promise.resolve(
        ok({ token: `token-${counter}`, credential_ref: `ref-${counter}` }),
      );
    },
    endBy(condition, value) {
      ended.push([condition, value]);
      return 1;
    },
  };
  return { issuer, issued, ended };
}

function credentials(issuer: AgentCredentialIssuer) {
  return createRunCredentials({
    issuer,
    operations: ["ReadRun"],
    process: "agent-runtime",
  });
}

Deno.test("platform/ledger#R11: agent credential은 유효 assignment·run 하나에 묶여 발급되고 StartRun의 scope를 그대로 싣는다", async () => {
  const { issuer, issued } = recordingIssuer();
  const held = credentials(issuer);
  const credential = await held.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(credential.ok);
  assertEquals(credential.value.token, "token-1");
  assertEquals(issued, [{
    actor: `agent:${ASG}`,
    principal: `agent:${ASG}`,
    scope: {
      operations: ["ReadRun"],
      targets: { assignment: ASG, run: RUN },
      agent: SCOPE,
    },
    conditions: { assignment: ASG, run: RUN, process: "agent-runtime" },
  }]);
  assertEquals(held.live(), [RUN]);
  // 같은 run에 둘째 credential은 없다.
  const second = await held.open({ run: RUN, assignment: ASG, scope: SCOPE });
  assert(!second.ok);
  assertEquals(second.error.code, "conflict");
  assertEquals(issued.length, 1);
  // 다른 assignment의 scope로는 발급하지 않는다(발급 경계에 요청도 가지 않는다).
  const forged = await held.open({
    run: OTHER_RUN,
    assignment: OTHER_ASG,
    scope: SCOPE,
  });
  assert(!forged.ok);
  assertEquals(forged.error.code, "forbidden");
  assertEquals(issued.length, 1);
});

Deno.test("platform/ledger#R11: run 종료·assignment 멈춤·감독 상실은 agent credential을 끝낸다", async () => {
  const { issuer, ended } = recordingIssuer();
  const held = credentials(issuer);
  await held.open({ run: RUN, assignment: ASG, scope: SCOPE });
  await held.open({
    run: OTHER_RUN,
    assignment: OTHER_ASG,
    scope: { ...SCOPE, assignment: OTHER_ASG },
  });
  assertEquals(held.live().sort(), [RUN, OTHER_RUN].sort());
  // run 종료는 그 run의 credential만 끝낸다.
  held.end(RUN);
  assertEquals(ended, [["run", RUN]]);
  assertEquals(held.live(), [OTHER_RUN]);
  // 끝난 run은 같은 자리를 다시 열 수 있지만 새 credential이다(끝난 것은 되살아나지 않는다).
  const reopened = await held.open({ run: RUN, assignment: ASG, scope: SCOPE });
  assert(reopened.ok);
  assertEquals(reopened.value.credential_ref, "ref-3");
  // assignment 멈춤은 그 assignment의 것을 모두 끝낸다.
  held.endAssignment(ASG);
  assertEquals(ended.at(-1), ["assignment", ASG]);
  assertEquals(held.live(), [OTHER_RUN]);
  // 감독 상실은 들고 있는 모든 credential을 끝낸다.
  held.endAll();
  assertEquals(held.live(), []);
  assertEquals(ended.at(-1), ["run", OTHER_RUN]);
});

Deno.test("platform/ledger#R11: 발급이 거절되면 자리를 비우고 시작이 거절되면 credential은 만들지 않는다", async () => {
  const failing = recordingIssuer({ fail: true });
  const held = credentials(failing.issuer);
  const refused = await held.open({ run: RUN, assignment: ASG, scope: SCOPE });
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
  assertEquals(held.live(), []);

  // StartRun이 거절되면 발급 경계에 요청이 가지 않는다.
  const never = recordingIssuer();
  const unstarted = await beginRun(
    {
      credentials: credentials(never.issuer),
      startRun: (): Promise<Result<never>> =>
        Promise.resolve(err({ code: "conflict", message: "state moved" })),
    },
    {
      run: RUN,
      assignment: ASG,
      stateSeq: "5",
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: SCOPE,
    },
  );
  assert(!unstarted.ok);
  assertEquals(unstarted.started, false);
  assertEquals(never.issued.length, 0);

  // 시작은 확정됐는데 발급이 거절되면 started=true로 알려 호출자가 run을 닫게 한다.
  const started = await beginRun(
    {
      credentials: credentials(failing.issuer),
      startRun: () =>
        Promise.resolve(
          ok({ run: RUN, state_seq: "6", basis: "b".repeat(64) }),
        ),
    },
    {
      run: RUN,
      assignment: ASG,
      stateSeq: "5",
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: SCOPE,
    },
  );
  assert(!started.ok);
  assertEquals(started.started, true);

  // 정상: 시작 뒤 credential이 같은 run의 것으로 나온다.
  const good = recordingIssuer();
  const begun = await beginRun(
    {
      credentials: credentials(good.issuer),
      startRun: () =>
        Promise.resolve(
          ok({ run: RUN, state_seq: "6", basis: "b".repeat(64) }),
        ),
    },
    {
      run: RUN,
      assignment: ASG,
      stateSeq: "5",
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: SCOPE,
    },
  );
  assert(begun.ok);
  assertEquals(begun.value.credential.run, RUN);
  assertEquals(begun.value.started.state_seq, "6");
});
