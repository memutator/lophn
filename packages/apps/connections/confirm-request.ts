// A→B confirm=true 호출의 approval 요청과 결과 수령(apps/connections#R3). 호출한 앱 자식이 broker로
// 정확한 (대상 앱·release·command·입력)의 approval을 요청하고, 사람의 결정을 짧은 poll로 기다려
// 서명된 proof를 받는다. 신원은 자식 연결이 정하고 입력 지문은 대상의 고정 blueprint로 계산한다.
// proof는 approval이 적용돼 접수가 확정된 뒤에만 나오므로 approval은 한 번만 쓰인다.
import { err, type IdSource, ok, type Result } from "../../base/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../protocol/apps/mod.ts";
import {
  type ConfirmAcceptances,
  type ConfirmProof,
  createConfirmProofIssuer,
} from "./confirm.ts";
import type { PathBook } from "./origin.ts";
import { inspectPair, type PairDeps, type PairSource } from "./prepare.ts";
import type { CoreSigner } from "../runtime/mod.ts";

export type ApprovalState = "pending" | "granted" | "rejected" | "expired";

// 대상 앱의 고정 blueprint를 아는 쪽(core)이 입력 지문을 계산한다. command가 confirm=true가
// 아니거나 입력이 선언 schema에 맞지 않으면 invalid_input이다.
export interface ConfirmTargets {
  prepare(input: {
    app: string;
    release: string;
    command: string;
    input: unknown;
  }): Promise<Result<{ input_hash: string }>>;
}

// core의 approval 쪽. 요청자는 호출한 앱(app credential)이고 사람의 결정은 별도다.
export interface ConfirmApprovals {
  create(request: {
    approval: string;
    source: PairSource;
    accept: InvocationAcceptConfirmInput;
  }): Promise<Result<void>>;
  state(approval: string): Promise<Result<ApprovalState>>;
  // 허락된 approval을 적용한다(`apply_approved_action`). 같은 approval은 한 번만 쓰인다.
  apply(approval: string): Promise<Result<void>>;
}

export type ConfirmRequest = {
  source: PairSource;
  app: string;
  command: string;
  input?: unknown;
  target_release: string;
  target_process_nonce: string;
  parent_invocation: string | null;
};

export type ConfirmPollResult =
  | { state: "pending" }
  | { state: "granted"; invocation: string; proof: ConfirmProof["proof"] }
  | { state: "rejected" }
  | { state: "expired" };

export type PairConfirmer = {
  request(request: ConfirmRequest): Promise<
    Result<{ approval: string; input_hash: string; state: "pending" }>
  >;
  poll(request: {
    source: PairSource;
    approval: string;
    wait_ms: number;
  }): Promise<Result<ConfirmPollResult>>;
};

// 한 자식이 동시에 기다릴 수 있는 approval 수와 전체 상한이다.
export const PENDING_PER_SOURCE_LIMIT = 32;
export const PENDING_LIMIT = 1024;
const POLL_STEP_MS = 250;

type Pending = {
  source: PairSource;
  accept: InvocationAcceptConfirmInput;
  settling?: Promise<Result<ConfirmPollResult>>;
};

export type PairConfirmerDeps = Pick<PairDeps, "process" | "facts"> & {
  signer: CoreSigner;
  paths: PathBook;
  ids: IdSource;
  targets: ConfirmTargets;
  approvals: ConfirmApprovals;
  accepted: ConfirmAcceptances;
  sleep?: (ms: number) => Promise<void>;
};

export function createPairConfirmer(deps: PairConfirmerDeps): PairConfirmer {
  const pending = new Map<string, Pending>();
  const issuer = createConfirmProofIssuer(deps);
  const sleep = deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function settle(
    approval: string,
    held: Pending,
  ): Promise<Result<ConfirmPollResult>> {
    const applied = await deps.approvals.apply(approval);
    if (!applied.ok) return applied;
    const issued = await issuer.issue({
      source: held.source,
      accept: held.accept,
    });
    pending.delete(approval);
    if (!issued.ok) return issued;
    return ok({
      state: "granted",
      invocation: issued.value.invocation,
      proof: issued.value.proof,
    });
  }

  return {
    async request(request) {
      const { source } = request;
      let own = 0;
      for (const held of pending.values()) {
        if (held.source.processNonce === source.processNonce) own += 1;
      }
      if (own >= PENDING_PER_SOURCE_LIMIT || pending.size >= PENDING_LIMIT) {
        return err({ code: "unavailable", message: "too many open approvals" });
      }
      const found = await inspectPair(deps, {
        source,
        app: request.app,
        commands: [request.command],
      });
      if (!found.ok) return found;
      // 호출할 연결이 묶인 프로세스와 지금 대상 프로세스가 같아야 proof가 그 연결에서 쓰인다.
      if (
        found.value.target.processNonce !== request.target_process_nonce ||
        found.value.target.release !== request.target_release
      ) {
        return err({
          code: "conflict",
          message: "confirm target is not the current process",
        });
      }
      const prepared = await deps.targets.prepare({
        app: request.app,
        release: request.target_release,
        command: request.command,
        input: request.input,
      });
      if (!prepared.ok) return prepared;
      const approval = deps.ids.newId("apr");
      const accept: InvocationAcceptConfirmInput = {
        app: request.app,
        release: request.target_release,
        command: request.command,
        input_hash: prepared.value.input_hash,
        approval,
        key: `confirm-${approval}`,
        process_nonce: request.target_process_nonce,
        caller: {
          kind: "app",
          app: source.app,
          release: source.release as string,
          parent_invocation: deps.paths.parentOf(
            source.processNonce,
            request.parent_invocation,
          ),
        },
      };
      const created = await deps.approvals.create({ approval, source, accept });
      if (!created.ok) return created;
      pending.set(approval, { source, accept });
      return ok({
        approval,
        input_hash: prepared.value.input_hash,
        state: "pending",
      });
    },
    async poll({ source, approval, wait_ms }) {
      const held = pending.get(approval);
      // 다른 자식의 approval은 없는 것과 같다.
      if (
        held === undefined || held.source.processNonce !== source.processNonce
      ) {
        return err({ code: "not_found", message: "approval not found" });
      }
      const deadline = Date.now() + wait_ms;
      while (true) {
        if (held.settling !== undefined) return await held.settling;
        const current = await deps.approvals.state(approval);
        if (!current.ok) return current;
        if (current.value === "rejected" || current.value === "expired") {
          pending.delete(approval);
          return ok({ state: current.value });
        }
        if (current.value === "granted") {
          held.settling = settle(approval, held);
          return await held.settling;
        }
        if (Date.now() >= deadline) return ok({ state: "pending" });
        await sleep(Math.min(POLL_STEP_MS, Math.max(0, deadline - Date.now())));
      }
    },
  };
}
