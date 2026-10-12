// grant 변경의 적용 순서다(apps/permissions#R20, R21, R22, R29). 새 호출 차단 -> 기존 자식 종료 확인
// -> 새 범위로 재시작. 종료를 확인하지 못하면 새 자식을 띄우지 않고 회수도 완료로 표시하지 않는다.
// 이미 한 업무 쓰기나 외부 전송을 취소하지 않는다. 막는 것은 앞으로의 접근뿐이다.
import { type LophnError, ok, type Result } from "../../../../base/mod.ts";
import type { Grant, GrantRevokeInput } from "../../../../protocol/apps/mod.ts";

export type StopResult =
  // OS가 자식 종료를 확인했다. 이미 멈춰 있었다면 processNonce는 null이다.
  | { confirmed: true; processNonce: string | null }
  | { confirmed: false };

// supervisor 쪽 자식 수명이다. start는 새 flags·새 nonce로 시작하며 종료를 확인하기 전에는
// 이 모듈이 부르지 않는다.
export interface AppProcesses {
  stop(app: string): Promise<StopResult>;
  start(app: string): Promise<void>;
}

// 앱의 broker 연결을 새 요청부터 막는다(BrokerHub가 구현).
export interface BrokerGate {
  blockApp(app: string): number;
}

// 앱이 source이거나 target인 서명된 직접 연결(AppConnection)을 새 호출부터 막는다. 연결 쪽
// 구현은 apps/runtime이다. 같은 앱이 새 nonce로 다시 시작해도 옛 연결은 쓰지 못한다.
export interface ConnectionGate {
  close(app: string): void;
}

// core의 `grant.revoke`다. 종료 확인 근거를 입력에 실어 보낸다. 근거가 없으면 core가
// unavailable로 거절하고 grant는 active로 남는다.
export interface GrantRevoker {
  revoke(input: GrantRevokeInput): Promise<Result<unknown>>;
}

// 현재 선언과 active grant로 이 secret 이름을 쓰는 앱을 찾는다.
export interface SecretUsers {
  appsUsing(name: string): Promise<Result<readonly string[]>>;
}

export type ApplyOutcome =
  | { state: "applied" }
  // 요청은 접수했지만 종료를 확인하지 못했다. grant는 아직 active이고 새 자식은 없다.
  | { state: "in_progress"; reason: string }
  | { state: "failed"; error: LophnError };

export type ApplyGrantDeps = {
  broker: BrokerGate;
  connections: ConnectionGate;
  processes: AppProcesses;
  revoker: GrantRevoker;
  secrets: SecretUsers;
};

export type GrantApplier = {
  // 새 grant가 확정됐다. 확대는 새 프로세스에서만 보인다.
  created(grant: Pick<Grant, "app" | "kind">): Promise<ApplyOutcome>;
  // 회수 요청. 종료 확인 뒤에만 core가 revoked로 확정한다.
  revoke(grant: Pick<Grant, "id" | "app" | "kind">): Promise<ApplyOutcome>;
  // secret 값 교체·삭제. 사용 앱을 종료 확인과 새 nonce로 다시 시작한다(R17).
  secretChanged(
    name: string,
  ): Promise<Result<{ app: string; outcome: ApplyOutcome }[]>>;
};

const UNCONFIRMED = "the previous process termination is not confirmed";

export function createGrantApplier(deps: ApplyGrantDeps): GrantApplier {
  // 같은 앱의 변경은 순서대로 적용한다. 겹쳐도 새 자식이 둘 생기지 않는다.
  const queues = new Map<string, Promise<unknown>>();

  function serial<T>(app: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(app) ?? Promise.resolve();
    const run = previous.then(work, work);
    queues.set(app, run.catch(() => undefined));
    return run;
  }

  // 새 호출 차단. 직접 연결과 broker 연결이 모두 새 요청부터 닫힌다.
  function block(app: string): void {
    deps.broker.blockApp(app);
    deps.connections.close(app);
  }

  async function restart(app: string): Promise<ApplyOutcome> {
    try {
      await deps.processes.start(app);
    } catch {
      return {
        state: "failed",
        error: { code: "unavailable", message: "the app could not restart" },
      };
    }
    return { state: "applied" };
  }

  async function replace(app: string): Promise<ApplyOutcome> {
    block(app);
    const stopped = await deps.processes.stop(app);
    if (!stopped.confirmed) {
      return { state: "in_progress", reason: UNCONFIRMED };
    }
    return await restart(app);
  }

  return {
    created(grant) {
      // 자동 회차 허락은 clock이 회차마다 grant를 다시 확인하므로 재시작하지 않는다.
      if (grant.kind === "automation.run") {
        return Promise.resolve({ state: "applied" });
      }
      // 새 호출 차단은 접수 즉시다. 앞선 변경이 끝나기를 기다리지 않는다.
      block(grant.app);
      return serial(grant.app, () => replace(grant.app));
    },
    revoke(grant) {
      if (grant.kind !== "automation.run") block(grant.app);
      return serial<ApplyOutcome>(grant.app, async () => {
        if (grant.kind === "automation.run") {
          const revoked = await deps.revoker.revoke({
            grant: grant.id,
            process_nonce: null,
            termination_confirmed: null,
          });
          return revoked.ok ? { state: "applied" } : {
            state: "failed",
            error: revoked.error,
          };
        }
        block(grant.app);
        const stopped = await deps.processes.stop(grant.app);
        // 종료를 확인하지 못하면 통로를 끊었다는 이유만으로 회수 완료라고 하지 않는다(R21).
        if (!stopped.confirmed) {
          return { state: "in_progress", reason: UNCONFIRMED };
        }
        const revoked = await deps.revoker.revoke({
          grant: grant.id,
          process_nonce: stopped.processNonce,
          termination_confirmed: stopped.processNonce === null ? null : true,
        });
        if (!revoked.ok) return { state: "failed", error: revoked.error };
        return await restart(grant.app);
      });
    },
    async secretChanged(name) {
      const users = await deps.secrets.appsUsing(name);
      if (!users.ok) return users;
      const results: { app: string; outcome: ApplyOutcome }[] = [];
      for (const app of users.value) block(app);
      for (const app of users.value) {
        results.push({
          app,
          outcome: await serial<ApplyOutcome>(app, () => replace(app)),
        });
      }
      return ok(results);
    },
  };
}
