import type { z } from "zod";
import type { Result } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  turnRead,
  type WorkspaceKind,
  workspaceKindOf,
  workspaceSessionRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type { CredentialConditions } from "../../../protocol/server/mod.ts";
import {
  type AgentCredentialResponse,
  agentCredentialEndSchema,
  agentCredentialRequestSchema,
  type ChildMessage,
} from "../../../protocol/supervision/mod.ts";
import type { AgentCredentialIssuer } from "./mod.ts";

// agent runtime 감독 pipe의 agent credential 발급. child가 보낸 요청은 신뢰하지 않는다. turn이 있고 진행
// 중이며 요청한 session의 것인지, session이 열려 있는지, 요청한 operation이 그 session workspace 종류의 상한 안인지를
// core 자신의 기록으로 확인한다. 요청한 operation이 workspace 상한 밖이면 undefined로 끝내지 않고 forbidden 거부를 돌려준다.

type CoreCall = (path: string, body: unknown) => Promise<Result<unknown>>;

export type AgentCredentialDeniedResponse = {
  type: "agent_credential_response";
  request_id: string;
  ok: false;
  error: {
    code: "forbidden";
    message: string;
    operations: readonly string[];
  };
};

export type AgentCredentialReply =
  | AgentCredentialResponse
  | AgentCredentialDeniedResponse;

type AgentCredentialLink = {
  // child message를 처리한다. 발급했거나 operation 범위 거부가 나면 응답 message를, 그 밖(종료·무효 요청)에는 undefined를 돌려준다.
  onMessage(message: ChildMessage): Promise<AgentCredentialReply | undefined>;
};

export function createAgentCredentialLink(options: {
  // 발급은 인증 경계(CredentialRegistry)가 한다.
  issuer: AgentCredentialIssuer;
  // machine 자격의 loopback. turn과 session을 읽는다.
  machine: CoreCall;
  // 이 child process의 이름. credential의 process 조건이 된다.
  process: string;
  // workspace 종류의 operation 상한.
  operationsFor: (kind: WorkspaceKind) => readonly string[];
  // credential의 고정 조건. session과 turn, process에 workspace가 더하는 조건을 얹는다.
  conditionsFor: (input: {
    session: string;
    turn: string;
    process: string;
    workspace: { kind: string; id: string } | null;
  }) => CredentialConditions;
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
  ): Promise<AgentCredentialReply | undefined> {
    const turn = await read(turnRead, { turn: message.turn });
    if (
      turn === undefined ||
      turn.turn.state !== "running" ||
      turn.turn.session !== message.session
    )
      return undefined;
    const found = await read(workspaceSessionRead, {
      session: turn.turn.session,
    });
    if (found === undefined || found.session.lifecycle !== "open")
      return undefined;
    const kind = workspaceKindOf(found.session.workspace);
    const allowed = new Set(operationsFor(kind));
    const operations = [...new Set(message.operations)];
    const disallowed = operations.filter(
      (operation) => !allowed.has(operation),
    );
    if (disallowed.length > 0) {
      return {
        type: "agent_credential_response",
        request_id: message.request_id,
        ok: false,
        error: {
          code: "forbidden",
          message: `operations not permitted in ${kind} workspace: ${disallowed.join(", ")}`,
          operations: disallowed,
        },
      };
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
      conditions: options.conditionsFor({
        session: turn.turn.session,
        turn: message.turn,
        process: options.process,
        workspace: found.session.workspace,
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
