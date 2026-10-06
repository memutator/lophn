import type { z } from "zod";
import { canonicalize, type Result } from "../../packages/base/mod.ts";
import {
  agentAppScopeSchema,
  assignmentRead,
  runRead,
  runStarted,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  agentCredentialEndSchema,
  agentCredentialRequestSchema,
  type AgentCredentialResponse,
  type ChildMessage,
  eventsList,
  routePath,
} from "../../packages/contracts/platform/mod.ts";
import { roleOperations } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
export { roleOperations };
import type { AgentCredentialIssuer } from "../../packages/lophn-agent/harness/run-loop/mod.ts";

// agent runtime 감독 pipe의 agent credential 발급(lophn-agent/harness/run-loop). child가 보낸
// 요청은 신뢰하지 않는다. run이 있고 진행 중이며 요청한 assignment의 것인지, 요청한 scope가
// StartRun이 확정한 AgentAppScope와 같은지, 요청한 operation이 그 assignment 역할의 상한 안인지를
// core 자신의 ledger 기록으로 확인한다. 어느 하나라도 어긋나면 없는 run과 똑같이 답하지 않는다.

export type CoreCall = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;

export type AgentCredentialLink = {
  // child message를 처리한다. 발급했으면 응답 message를, 그 밖(거절·종료 처리)에는 undefined를 돌려준다.
  onMessage(
    message: ChildMessage,
  ): Promise<AgentCredentialResponse | undefined>;
};

export function createAgentCredentialLink(options: {
  // 발급은 인증 경계(CredentialRegistry)가 한다.
  issuer: AgentCredentialIssuer;
  // machine 자격의 loopback. run·assignment·event를 읽는다.
  machine: CoreCall;
  // 이 child process의 이름. credential의 process 조건이 된다.
  process: string;
  // 역할의 operation 상한. 기본은 ROLE_CAPS에서 낸다.
  operationsFor?: (role: string) => readonly string[];
}): AgentCredentialLink {
  const operationsFor = options.operationsFor ?? roleOperations;

  async function read<O extends z.ZodType>(
    route: { resource: string; method: string; output: O },
    body: unknown,
  ): Promise<z.output<O> | undefined> {
    const reply = await options.machine(routePath(route), body);
    if (!reply.ok) return undefined;
    const parsed = route.output.safeParse(reply.value);
    return parsed.success ? parsed.data : undefined;
  }

  async function issue(
    message: ReturnType<typeof agentCredentialRequestSchema.parse>,
  ): Promise<AgentCredentialResponse | undefined> {
    const run = await read(runRead, { run: message.run });
    if (
      run === undefined || run.run.state !== "running" ||
      run.run.assignment !== message.assignment
    ) return undefined;
    const assigned = await read(assignmentRead, {
      assignment: message.assignment,
    });
    if (
      assigned === undefined || assigned.assignment.id !== message.assignment ||
      assigned.assignment.state !== "enabled"
    ) return undefined;
    // 요청한 scope는 StartRun이 확정한 값과 같아야 한다. 넓히지도 좁히지도 않는다.
    // 이벤트 목록은 훑은 만큼씩 끊어 준다. 이 run의 RunStarted를 만날 때까지 이어 읽는다.
    let scope: unknown;
    for (let after = "0", pages = 0; pages < 1000; pages++) {
      const page = await read(eventsList, {
        after_seq: after,
        types: [runStarted.type],
        subjects: [message.run],
      });
      if (page === undefined) return undefined;
      const found = page.events[0];
      if (found !== undefined) {
        scope = found.payload["scope"];
        break;
      }
      if (page.next_cursor === null || page.next_cursor === undefined) break;
      after = page.next_cursor;
    }
    const fixed = agentAppScopeSchema.safeParse(scope);
    const requested = agentAppScopeSchema.safeParse(message.scope);
    if (
      !fixed.success || !requested.success ||
      fixed.data.assignment !== message.assignment ||
      fixed.data.role !== assigned.assignment.role ||
      canonicalize(fixed.data) !== canonicalize(requested.data)
    ) return undefined;
    const allowed = new Set(operationsFor(assigned.assignment.role));
    const operations = [...new Set(message.operations)];
    if (operations.some((operation) => !allowed.has(operation))) {
      return undefined;
    }
    // 같은 run의 이전 credential은 새로 받기 전에 끝낸다.
    options.issuer.endBy("run", message.run);
    const issued = await options.issuer.issue({
      actor: `agent:${message.assignment}`,
      principal: `agent:${message.assignment}`,
      scope: {
        operations,
        targets: { assignment: message.assignment, run: message.run },
        agent: fixed.data,
      },
      conditions: {
        assignment: message.assignment,
        run: message.run,
        process: options.process,
      },
    });
    if (!issued.ok) return undefined;
    return {
      type: "agent_credential_response",
      request_id: message.request_id,
      credential: issued.value.token,
      credential_ref: issued.value.credential_ref,
    };
  }

  return {
    async onMessage(message) {
      if (message.type === "agent_credential_end") {
        const ended = agentCredentialEndSchema.safeParse(message);
        if (ended.success) options.issuer.endBy("run", ended.data.run);
        return undefined;
      }
      if (message.type !== "agent_credential_request") return undefined;
      const parsed = agentCredentialRequestSchema.safeParse(message);
      if (!parsed.success) return undefined;
      try {
        return await issue(parsed.data);
      } catch {
        return undefined;
      }
    },
  };
}
