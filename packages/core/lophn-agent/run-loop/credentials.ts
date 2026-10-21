import { err, ok, type Result } from "../../../base/mod.ts";
import type { TurnMode } from "../../../protocol/lophn-agent/mod.ts";
import type {
  CredentialConditions,
  CredentialScope,
} from "../../../protocol/server/mod.ts";

// turn마다 agent credential을 받고 끝내는 자리(`agent:<ses>`). 발급은 core의 인증 경계가 하고 이 모듈은 그
// port를 부른다. credential은 session 하나와 그 안에서 도는 turn 하나에 묶이고, 닿는 operation은 역할 상한
// 안이다. token은 메모리에만 있고 반환값 밖(log·오류·ledger)에 나가지 않는다.

// 인증 경계의 발급 interface(CredentialRegistry와 같은 모양). lophn-agent는 최상위 사이 import 금지로 그
// 구현을 import하지 않고 이 모양만 요구한다.
export type AgentCredentialIssuer = {
  issue(input: {
    actor: `agent:${string}`;
    principal: string;
    scope: CredentialScope;
    conditions: CredentialConditions;
  }): Promise<Result<{ token: string; credential_ref: string }>>;
  endBy(condition: "turn" | "session", value: string): number;
};

export type AgentTurnCredential = {
  turn: string;
  session: string;
  token: string;
  credential_ref: string;
};

type TurnCredentialOptions = {
  issuer: AgentCredentialIssuer;
  // agent actor가 닿을 수 있는 operation 이름. 인증 경계의 발급 상한 안이어야 한다. 함수이면 session의
  // 역할마다 정한다.
  operations:
    | readonly string[]
    | ((role: string) => readonly string[]);
  // 감독 pipe가 정한 runtime process 이름.
  process: string;
};

export type TurnCredentials = {
  // StartTurn이 확정된 turn에 대해 credential을 발급한다. 같은 turn에 둘은 없다.
  open(input: {
    turn: string;
    session: string;
    role: string;
  }): Promise<Result<AgentTurnCredential>>;
  // turn 종료·멈춤 때. 새 사용은 즉시 막힌다.
  end(turn: string): number;
  // session 끝남 때.
  endSession(session: string): number;
  // 감독 상실·종료 때 들고 있는 것을 모두.
  endAll(): number;
  // 메모리에 있는 활성 credential의 turn 목록.
  live(): string[];
};

export function createTurnCredentials(
  options: TurnCredentialOptions,
): TurnCredentials {
  const held = new Map<string, string>();
  return {
    async open(input) {
      if (held.has(input.turn)) {
        return err({
          code: "conflict",
          message: "this turn already has a credential",
        });
      }
      // 같은 turn의 동시 open이 둘 다 발급받지 못하게 먼저 자리를 잡는다.
      held.set(input.turn, input.session);
      const issued = await options.issuer.issue({
        actor: `agent:${input.session}`,
        principal: `agent:${input.session}`,
        scope: {
          operations: [
            ...(typeof options.operations === "function"
              ? options.operations(input.role)
              : options.operations),
          ],
          targets: { session: input.session, turn: input.turn },
        },
        conditions: {
          turn: input.turn,
          session: input.session,
          process: options.process,
        },
      });
      if (!issued.ok) {
        held.delete(input.turn);
        return issued;
      }
      return ok({
        turn: input.turn,
        session: input.session,
        token: issued.value.token,
        credential_ref: issued.value.credential_ref,
      });
    },
    end(turn) {
      const had = held.delete(turn);
      const ended = options.issuer.endBy("turn", turn);
      return had ? Math.max(ended, 1) : ended;
    },
    endSession(session) {
      for (const [turn, owner] of [...held]) {
        if (owner === session) held.delete(turn);
      }
      return options.issuer.endBy("session", session);
    },
    endAll() {
      let ended = 0;
      for (const [turn] of [...held]) {
        ended += options.issuer.endBy("turn", turn);
        held.delete(turn);
      }
      return ended;
    },
    live() {
      return [...held.keys()];
    },
  };
}

export type StartTurnResult = {
  turn: string;
  state_seq: string;
  basis: string;
};

export type BeginTurnInput = {
  turn: string;
  session: string;
  role: string;
  // 입력함이 turn을 시작한 입력의 session 기록 message.
  inputMessage: string;
  basis: string;
  // 준비한 basis blob의 크기. 있으면 StartTurn이 영구 참조를 등록한다.
  basisSize?: number;
  // 고정한 resolved agent 전체 값의 blob과 크기. 있으면 StartTurn이 영구 참조를 등록한다.
  resolved?: string;
  resolvedSize?: number;
  limits: { model_attempts: number; stall_ms: number; active_ms: number };
  mode: TurnMode;
};

type BeginTurnDeps = {
  credentials: TurnCredentials;
  // StartTurn command 호출. 호출자가 machine credential로 보낸다.
  startTurn(input: BeginTurnInput): Promise<Result<StartTurnResult>>;
};

// StartTurn을 확정한 뒤에 credential을 발급한다. 발급이 실패하면 turn은 이미 running이므로 started=true로
// 알려 호출자가 FinishTurn(failed, configuration_unavailable)로 닫게 한다. 시작이 거절되면 credential은
// 만들지 않는다.
export async function beginTurn(
  deps: BeginTurnDeps,
  input: BeginTurnInput,
): Promise<
  | {
    ok: true;
    value: { started: StartTurnResult; credential: AgentTurnCredential };
  }
  | { ok: false; started: boolean; error: { code: string; message: string } }
> {
  const started = await deps.startTurn(input);
  if (!started.ok) {
    return { ok: false, started: false, error: started.error };
  }
  const credential = await deps.credentials.open({
    turn: input.turn,
    session: input.session,
    role: input.role,
  });
  if (!credential.ok) {
    return { ok: false, started: true, error: credential.error };
  }
  return {
    ok: true,
    value: { started: started.value, credential: credential.value },
  };
}
