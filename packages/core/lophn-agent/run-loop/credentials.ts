import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AgentAppScope,
  RunBasis,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CredentialConditions,
  CredentialScope,
} from "../../../protocol/server/mod.ts";

// run마다 agent credential을 받고 끝내는 자리(architecture/platform 5.6의 `agent:<asg>`).
// 발급은 platform의 인증 경계가 하고 이 모듈은 그 port를 부른다. credential은
// 유효 assignment·run 하나에 묶이고 AgentAppScope는 StartRun에 실은 값 그대로다.
// platform이 상한을 넓히지 못하게 하고, 이 모듈도 scope를 고치지 않는다.
// token은 메모리에만 있고 반환값 밖(log·오류·ledger)에 나가지 않는다.

// platform 인증 경계의 발급 interface(CredentialRegistry와 같은 모양). lophn-agent는
// 최상위 사이 import 금지로 그 구현을 import하지 않고 이 모양만 요구한다.
export type AgentCredentialIssuer = {
  issue(input: {
    actor: `agent:${string}`;
    principal: string;
    scope: CredentialScope & { agent: AgentAppScope };
    conditions: CredentialConditions;
  }): Promise<Result<{ token: string; credential_ref: string }>>;
  endBy(condition: "run" | "assignment", value: string): number;
};

export type AgentRunCredential = {
  run: string;
  assignment: string;
  token: string;
  credential_ref: string;
};

export type RunCredentialOptions = {
  issuer: AgentCredentialIssuer;
  // agent actor가 닿을 수 있는 operation 이름. platform의 발급 상한 안이어야 한다.
  // 함수이면 run의 AgentAppScope(역할)마다 정한다. 역할 상한 안의 목록만 발급을 받는다.
  operations:
    | readonly string[]
    | ((scope: AgentAppScope) => readonly string[]);
  // 감독 pipe가 정한 runtime process 이름.
  process: string;
};

export type RunCredentials = {
  // StartRun이 확정된 run에 대해 credential을 발급한다. 같은 run에 둘은 없다.
  open(input: {
    run: string;
    assignment: string;
    scope: AgentAppScope;
  }): Promise<Result<AgentRunCredential>>;
  // run 종료·멈춤 때. 새 사용은 즉시 막힌다.
  end(run: string): number;
  // assignment 멈춤·회수 때.
  endAssignment(assignment: string): number;
  // 감독 상실·종료 때 들고 있는 것을 모두.
  endAll(): number;
  // 메모리에 있는 활성 credential의 run 목록.
  live(): string[];
};

export function createRunCredentials(
  options: RunCredentialOptions,
): RunCredentials {
  const held = new Map<string, string>();
  return {
    async open(input) {
      if (held.has(input.run)) {
        return err({
          code: "conflict",
          message: "this run already has a credential",
        });
      }
      if (input.scope.assignment !== input.assignment) {
        return err({
          code: "forbidden",
          message: "scope does not belong to this assignment",
        });
      }
      // 같은 run의 동시 open이 둘 다 발급받지 못하게 먼저 자리를 잡는다.
      held.set(input.run, input.assignment);
      const issued = await options.issuer.issue({
        actor: `agent:${input.assignment}`,
        principal: `agent:${input.assignment}`,
        scope: {
          operations: [
            ...(typeof options.operations === "function"
              ? options.operations(input.scope)
              : options.operations),
          ],
          targets: { assignment: input.assignment, run: input.run },
          agent: input.scope,
        },
        conditions: {
          assignment: input.assignment,
          run: input.run,
          process: options.process,
        },
      });
      if (!issued.ok) {
        held.delete(input.run);
        return issued;
      }
      return ok({
        run: input.run,
        assignment: input.assignment,
        token: issued.value.token,
        credential_ref: issued.value.credential_ref,
      });
    },
    end(run) {
      const had = held.delete(run);
      const ended = options.issuer.endBy("run", run);
      return had ? Math.max(ended, 1) : ended;
    },
    endAssignment(assignment) {
      for (const [run, owner] of [...held]) {
        if (owner === assignment) held.delete(run);
      }
      return options.issuer.endBy("assignment", assignment);
    },
    endAll() {
      let ended = 0;
      for (const [run] of [...held]) {
        ended += options.issuer.endBy("run", run);
        held.delete(run);
      }
      return ended;
    },
    live() {
      return [...held.keys()];
    },
  };
}

export type StartRunResult = {
  run: string;
  state_seq: string;
  basis: string;
};

export type BeginRunInput = {
  run: string;
  assignment: string;
  stateSeq: string;
  basis: string;
  // 준비한 basis blob의 크기. 있으면 StartRun이 영구 참조를 등록한다.
  basisSize?: number;
  // 고정한 resolved agent 전체 값의 blob과 크기. 있으면 StartRun이 영구 참조를 등록한다.
  agent?: string;
  agentSize?: number;
  limits: RunBasis["limits"];
  scope: AgentAppScope;
};

export type BeginRunDeps = {
  credentials: RunCredentials;
  // StartRun command 호출. 호출자가 machine credential로 보낸다.
  startRun(input: BeginRunInput): Promise<Result<StartRunResult>>;
};

// StartRun을 확정한 뒤에 credential을 발급한다. 발급이 실패하면 run은 이미 running이므로
// started=true로 알려 호출자가 FinishRun(failed, configuration_unavailable)로 닫게 한다.
// 시작이 거절되면 credential은 만들지 않는다.
export async function beginRun(
  deps: BeginRunDeps,
  input: BeginRunInput,
): Promise<
  | {
    ok: true;
    value: { started: StartRunResult; credential: AgentRunCredential };
  }
  | { ok: false; started: boolean; error: { code: string; message: string } }
> {
  const started = await deps.startRun(input);
  if (!started.ok) {
    return { ok: false, started: false, error: started.error };
  }
  const credential = await deps.credentials.open({
    run: input.run,
    assignment: input.assignment,
    scope: input.scope,
  });
  if (!credential.ok) {
    return { ok: false, started: true, error: credential.error };
  }
  return {
    ok: true,
    value: { started: started.value, credential: credential.value },
  };
}
