// A→B confirm=true 호출의 core 쪽 어댑터(apps/connections#R3). 준비 서비스(`createPairConfirmer`)가 쓰는
// approval 생성·상태·적용과 접수 재조회를 core의 approval command·ledger에 잇는다.
//   - 생성: 요청자는 호출한 앱 자신이다(`create_approval_request`는 요청자와 자격이 같아야 한다). 그 앱의
//     짧은 app credential을 발급해 같은 core 입구(approval 글 준비를 지나는 writer)로 낸다.
//   - 상태: 사람이 결정했는지는 ledger의 approval 행을 읽는다(결정은 shell의 confirmation window가 한다).
//   - 적용: machine이 `apply_approved_action`을 낸다. 접수(`invocation.accept_confirm`)는 같은
//     transaction에서 dispatch된다(platform Q28).
//   - 접수 재조회: core에 저장된 접수 사실(invocations의 approval과 InvocationAccepted 시각)에서 proof payload를
//     다시 만든다. 접수가 없으면 not_found다.
import { type Clock, err, ok, type Result } from "../../packages/base/mod.ts";
import {
  applyApprovedAction,
  type ApprovalAction,
  createApprovalRequest,
  type RequestContext,
} from "../../packages/protocol/server/mod.ts";
import { confirmAction } from "../../packages/core/approvals/mod.ts";
import { openConnection } from "../../packages/core/storage/ledger/mod.ts";
import { existingAcceptance } from "../../packages/core/apps/invocations/confirm.ts";
import type {
  ApprovalState,
  ConfirmApprovals,
} from "../../packages/core/apps/connections/confirm-request.ts";
import type { ConfirmAcceptances } from "../../packages/core/apps/connections/confirm.ts";
import type { PairSource } from "../../packages/core/apps/connections/prepare.ts";

// 사람이 결정을 기다려 주는 기한이다. 지나면 approval은 만료다.
export const CONFIRM_APPROVAL_TTL_MS = 10 * 60_000;

type Envelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: string[];
};

export type ConfirmAdapterDeps = {
  clock: Clock;
  ledgerPath: string;
  // approval 글 준비를 지나는 core의 writer다. core 조립이 늦게 채우므로 호출 때 읽는다.
  command(
    ctx: RequestContext,
    envelope: Envelope,
  ): Promise<Result<unknown>> | undefined;
  // `apply_approved_action`을 내는 core 내부 machine 자격이다.
  machine(): RequestContext | undefined;
  // 호출한 앱의 짧은 app credential이다. 한 번 쓰고 `end`로 끝낸다.
  requester(
    source: PairSource,
  ): Promise<Result<{ context: RequestContext; end(): void }>>;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export function createConfirmAdapters(deps: ConfirmAdapterDeps): {
  approvals: ConfirmApprovals;
  accepted: ConfirmAcceptances;
} {
  // approval 하나의 action. 적용은 만들 때의 action 그대로여야 한다. core 메모리이고 잃으면 그 approval은
  // 적용하지 못한 채 기한으로 끝난다(새 호출이 새 approval을 만든다).
  const actions = new Map<string, ApprovalAction>();
  return {
    approvals: {
      async create({ approval, source, accept }) {
        const requester = `app:${source.app}` as const;
        const action = confirmAction(requester, accept);
        const issued = await deps.requester(source);
        if (!issued.ok) return issued;
        try {
          const sent = deps.command(issued.value.context, {
            command: createApprovalRequest.name,
            input: {
              id: approval,
              requester,
              run: null,
              reason:
                `앱 ${source.app}이 앱 ${accept.app}의 확인이 필요한 명령 ${accept.command}를 부르려 한다.`,
              effect: {
                changes:
                  `앱 ${accept.app}의 명령 ${accept.command}를 이 입력으로 한 번 실행한다.`,
                external: null,
                reversible: false,
                reversibility:
                  "실행한 뒤에는 그 명령이 되돌림을 지원할 때만 되돌릴 수 있다.",
              },
              action,
              expires_at: new Date(
                deps.clock.nowMs() + CONFIRM_APPROVAL_TTL_MS,
              ).toISOString(),
            },
            idempotency_key: `confirm-create-${approval}`,
            compare: {},
            prepared: [],
          });
          if (sent === undefined) {
            return unavailable("approvals are unavailable");
          }
          const created = await sent;
          if (!created.ok) return created;
        } finally {
          issued.value.end();
        }
        actions.set(approval, action);
        return ok(undefined);
      },
      state(approval) {
        const opened = openConnection(deps.ledgerPath);
        if (!opened.ok) {
          return Promise.resolve(unavailable("ledger is unavailable"));
        }
        try {
          const row = opened.value.sql.get(
            "select status, expires_at from approval_requests where id = ?",
            [approval],
          );
          if (row === undefined) {
            return Promise.resolve(
              err({ code: "not_found", message: "approval not found" }),
            );
          }
          const status = String(row["status"]);
          const deadline = row["expires_at"] === null
            ? null
            : Date.parse(String(row["expires_at"]));
          let state: ApprovalState;
          if (status === "granted") state = "granted";
          else if (status === "rejected" || status === "cancelled") {
            state = "rejected";
          } else if (
            status === "expired" ||
            (deadline !== null && deps.clock.nowMs() >= deadline)
          ) state = "expired";
          else state = "pending";
          return Promise.resolve(ok(state));
        } catch {
          return Promise.resolve(unavailable("ledger is unavailable"));
        } finally {
          opened.value.close();
        }
      },
      async apply(approval) {
        const action = actions.get(approval);
        const machine = deps.machine();
        if (action === undefined || machine === undefined) {
          return unavailable("approval cannot be applied");
        }
        const sent = deps.command(machine, {
          command: applyApprovedAction.name,
          input: {
            approval,
            action,
            idempotency_key: `confirm-apply-${approval}`,
          },
          idempotency_key: `confirm-apply-${approval}`,
          compare: {},
          prepared: [],
        });
        if (sent === undefined) return unavailable("approvals are unavailable");
        const applied = await sent;
        return applied.ok ? ok(undefined) : applied;
      },
    },
    accepted: {
      find(input) {
        const opened = openConnection(deps.ledgerPath);
        if (!opened.ok) {
          return Promise.resolve(unavailable("ledger is unavailable"));
        }
        try {
          const found = existingAcceptance(opened.value.sql, input);
          if (!found.ok) return Promise.resolve(found);
          if (found.value === undefined) {
            return Promise.resolve(
              err({ code: "not_found", message: "acceptance not found" }),
            );
          }
          return Promise.resolve(ok(found.value));
        } catch {
          return Promise.resolve(unavailable("ledger is unavailable"));
        } finally {
          opened.value.close();
        }
      },
    },
  };
}
