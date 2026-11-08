import { ok, type Result } from "../../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  agentConditions,
  harnessOperations,
} from "../../../agent-workspaces/credentials.ts";
import type { CredentialRegistry } from "../../../server/identity/registry.ts";

// harness가 자기 shell에서 `lophn`을 부를 때 쓰는 agent 자격이다. lophn agent의 turn 자격과 같은 registry·같은
// 조건(session, turn)이고, 닿는 operation만 그 workspace 종류의 `lophn` 명령 route로 좁다. user token은 넘기지 않는다.
// 만료는 TurnEnded가 `end`를 부르는 것이고, core가 다시 뜨면 registry가 비어 모두 끝난다.
const HARNESS_PROCESS = "harness";

type CredentialInput = {
  session: string;
  turn: string;
  workspace: { kind: "project" | "app"; id: string } | null;
};

export type HarnessCredentials = {
  issue(input: CredentialInput): Promise<Result<string>>;
  // 같은 자격을 다른 process 이름으로 내고 token과 ref를 돌려준다. extension tool 호출이 호출 하나만 쓰는 자격에 쓰고
  // `release(ref)`로 그 자격만 거둔다(`end(turn)`은 그 turn의 다른 자격까지 끝낸다).
  lease(
    input: CredentialInput & { process: string },
  ): Promise<Result<{ token: string; ref: string }>>;
  release(ref: string): void;
  end(turn: string): void;
};

export function createHarnessCredentials(deps: {
  registry: CredentialRegistry;
  // 발급한 자격은 core 메모리의 token과 ledger 기록 둘이 있어야 쓰인다.
  record: (context: AuthenticatedContext) => Promise<Result<void>>;
}): HarnessCredentials {
  async function lease({
    session,
    turn,
    workspace,
    process,
  }: CredentialInput & { process: string }): Promise<
    Result<{ token: string; ref: string }>
  > {
    const issued = deps.registry.issue({
      actor: `agent:${session}`,
      principal: `agent:${session}`,
      scope: {
        operations: [...harnessOperations(workspace?.kind ?? "home")],
        targets: { session, turn },
      },
      conditions: agentConditions({ session, turn, process, workspace }),
    });
    if (!issued.ok) return issued;
    const ref = issued.value.credential_ref;
    const current = deps.registry.revalidate({ credential_ref: ref });
    if (!current.ok) return current;
    const recorded = await deps.record(current.value);
    if (!recorded.ok) {
      deps.registry.end(ref);
      return recorded;
    }
    return ok({ token: issued.value.token, ref });
  }
  return {
    lease,
    async issue(input) {
      const leased = await lease({ ...input, process: HARNESS_PROCESS });
      return leased.ok ? ok(leased.value.token) : leased;
    },
    release(ref) {
      deps.registry.end(ref);
    },
    end(turn) {
      deps.registry.endBy("turn", turn);
    },
  };
}
