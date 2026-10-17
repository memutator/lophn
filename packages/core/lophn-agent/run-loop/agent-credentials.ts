import type { z } from "zod";
import type { Result } from "../../../base/mod.ts";
import {
  agentSessionRead,
  turnRead,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  agentCredentialEndSchema,
  agentCredentialRequestSchema,
  type AgentCredentialResponse,
  type ChildMessage,
} from "../../../protocol/supervision/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import { roleOperations } from "./mod.ts";
export { roleOperations };
import type { AgentCredentialIssuer } from "./mod.ts";

// agent runtime 감독 pipe의 agent credential 발급. child가 보낸 요청은 신뢰하지 않는다. turn이 있고 진행
// 중이며 요청한 session의 것인지, session이 열려 있는지, 요청한 operation이 그 session 역할의 상한 안인지를
// core 자신의 기록으로 확인한다. 어느 하나라도 어긋나면 없는 turn과 똑같이 답하지 않는다.

// agent credential의 고정 조건이다. session과 turn에 묶인다. App Engineer는 담당 앱 하나에 묶이므로 그 앱을
// `app` 조건으로 고정한다: 다른 앱·project와 담당 앱이 아닌 문제·ticket 같은 자료는 요청 범위 밖이라 없는 자료와
// 같은 답이다. 다른 역할은 앱 조건이 없다. 앱 호출을 해도 되는지는 Gate와 agent grant가 가른다.
function agentConditions(input: {
  session: string;
  turn: string;
  process: string;
  role: string;
  place: { kind: string; id: string } | null;
}): {
  session: string;
  turn: string;
  process: string;
  app?: string;
} {
  const base = {
    session: input.session,
    turn: input.turn,
    process: input.process,
  };
  if (input.role !== "app_engineer" || input.place?.kind !== "app") return base;
  return { ...base, app: input.place.id };
}

type CoreCall = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;

type AgentCredentialLink = {
  // child message를 처리한다. 발급했으면 응답 message를, 그 밖(거절·종료 처리)에는 undefined를 돌려준다.
  onMessage(
    message: ChildMessage,
  ): Promise<AgentCredentialResponse | undefined>;
};

export function createAgentCredentialLink(options: {
  // 발급은 인증 경계(CredentialRegistry)가 한다.
  issuer: AgentCredentialIssuer;
  // machine 자격의 loopback. turn과 session을 읽는다.
  machine: CoreCall;
  // 이 child process의 이름. credential의 process 조건이 된다.
  process: string;
  // 역할의 operation 상한.
  operationsFor: (role: string) => readonly string[];
}): AgentCredentialLink {
  const { operationsFor } = options;

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
    const turn = await read(turnRead, { turn: message.turn });
    if (
      turn === undefined || turn.turn.state !== "running" ||
      turn.turn.session !== message.session
    ) return undefined;
    const found = await read(agentSessionRead, { session: turn.turn.session });
    if (
      found === undefined || found.session.lifecycle !== "open"
    ) return undefined;
    const role = found.session.agent.role;
    const allowed = new Set(operationsFor(role));
    const operations = [...new Set(message.operations)];
    if (operations.some((operation) => !allowed.has(operation))) {
      return undefined;
    }
    // 같은 turn의 이전 credential은 새로 받기 전에 끝낸다.
    options.issuer.endBy("turn", message.turn);
    const issued = await options.issuer.issue({
      actor: `agent:${turn.turn.session}`,
      principal: `agent:${turn.turn.session}`,
      scope: {
        operations,
        targets: { session: turn.turn.session, turn: message.turn },
      },
      conditions: agentConditions({
        session: turn.turn.session,
        turn: message.turn,
        process: options.process,
        role,
        place: found.session.place,
      }),
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
        if (ended.success) options.issuer.endBy("turn", ended.data.turn);
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
