// settings backup 복원(shell#T58, platform#T42에서 넘어온 것). renderer가 고른 묶음 하나의
// 복원 계획(잃을 최신 기록 범위)을 core 감독 pipe로 읽고, 사람이 확인하면 결정 handle을
// pipe로 발급해 복원을 청한다. 계획 응답은 contract `restore_plan`(lost·target·content_hash)이고
// 응답 결정 handle은 connection.registerConfirmation이 발급한다(confirmation_handle_register).
// 결정 이름은 `restore_backup` 하나뿐이다(platform/backup-and-migration#R13). 이 모듈은 계획과
// 결과의 바깥 모양만 돌려준다: pipe frame·handle 원문은 여기와 supervise.ts에만 있다.
import type {
  MainHello,
  MainToCoreMessage,
} from "../../../../protocol/supervision/mod.ts";
import type {
  RestoreLost,
  RestorePlanReply,
  RestoreSubmitReply,
} from "../../../ipc/restore.ts";

/** 계획 응답을 기다리는 시간. 넘으면 이 계획은 읽지 못했다. */
export const RESTORE_PLAN_REPLY_MS = 5_000;

/** 복원 결과를 기다리는 시간. 복원은 검증·보존·교체라 오래 걸릴 수 있다. */
export const RESTORE_RUN_REPLY_MS = 10 * 60_000;

/** 확인 handle 발급의 결정 이름. 복원 확인은 이 결정 하나다. */
export const RESTORE_DECISION = "restore_backup";

/** 복원 제출 때 handle 등록에 실리는 window id. */
export const RESTORE_WINDOW_ID = "settings-restore";

/** core pipe를 보내고 받는 통로. supervise.ts의 CoreProcess 모양이다. */
export interface RestorePipe {
  readonly phase: string;
  /** main→core 복원 메시지(restore_plan_request·restore_request)를 보낸다. */
  restore(message: MainToCoreMessage): boolean;
  /** 사람 결정 handle 등록(confirmation_handle_register)을 보낸다. */
  confirmation(message: MainToCoreMessage): boolean;
  /** core→main 메시지를 받는다(restore_plan·restore_result·restore_failed 등). */
  onMessage(listener: (payload: unknown) => void): () => void;
}

/** handle 발급에 필요한 값. connection.registerConfirmation이 돌려주는 모양이다. */
export type IssuedHandle = {
  readonly ok: true;
  readonly confirmation: string;
  readonly expiresAt: string;
} | {
  readonly ok: false;
};

/** 사람 결정 handle을 발급한다. connection.registerConfirmation을 그대로 부른다. */
export type IssueRestoreHandle = (
  request: {
    readonly target: string;
    readonly contentHash: string;
    readonly windowId: string;
  },
) => Promise<IssuedHandle>;

export type RestoreClock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** handle 등록·복원 요청의 expires_at 계산. ISO string이다. */
  nowMs(): number;
};

const realClock: RestoreClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) =>
    globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  nowMs: () => Date.now(),
};

/**
 * 복원 계획을 읽는다. `restore_plan_request`를 pipe로 보내 `restore_plan`을 기다린다.
 * `restore_failed`(stage plan)나 응답이 없으면 실패다. core는 아무것도 멈추지 않는다.
 */
export function readRestorePlan(
  pipe: RestorePipe,
  createdAt: string,
  clock: RestoreClock = realClock,
  replyMs: number = RESTORE_PLAN_REPLY_MS,
): Promise<RestorePlanReply> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RestorePlanReply) => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      off();
      resolve(value);
    };
    const off = pipe.onMessage((payload) => {
      const message = payload as {
        type?: unknown;
        created_at?: unknown;
        through_seq?: unknown;
        current_through_seq?: unknown;
        lost?: unknown;
        stage?: unknown;
        code?: unknown;
        message?: unknown;
      };
      if (message.type === "restore_plan" && message.created_at === createdAt) {
        if (
          typeof message.through_seq !== "string" ||
          typeof message.current_through_seq !== "string"
        ) {
          finish({
            ok: false,
            code: "internal",
            message: "복원 계획을 읽지 못했다",
          });
          return;
        }
        finish({
          ok: true,
          created_at: createdAt,
          through_seq: message.through_seq,
          current_through_seq: message.current_through_seq,
          lost: lostOf(message.lost),
        });
        return;
      }
      if (
        message.type === "restore_failed" &&
        message.stage === "plan" &&
        message.created_at === createdAt
      ) {
        finish({
          ok: false,
          code: String(message.code ?? "internal"),
          message: String(message.message ?? ""),
        });
      }
    });
    const timer = clock.setTimeout(
      () =>
        finish({
          ok: false,
          code: "unavailable",
          message: "복원 계획의 응답이 없다",
        }),
      replyMs,
    );
    const sent = pipe.restore({
      type: "restore_plan_request",
      created_at: createdAt,
    });
    if (!sent) {
      finish({
        ok: false,
        code: "unavailable",
        message: "core가 준비되지 않았다",
      });
    }
  });
}

function lostOf(lost: unknown): RestoreLost {
  if (
    lost !== null && typeof lost === "object" &&
    typeof (lost as { from_seq?: unknown }).from_seq === "string" &&
    typeof (lost as { through_seq?: unknown }).through_seq === "string" &&
    typeof (lost as { events?: unknown }).events === "number"
  ) {
    const record = lost as {
      from_seq: string;
      through_seq: string;
      events: number;
    };
    return {
      from_seq: record.from_seq,
      through_seq: record.through_seq,
      events: record.events,
    };
  }
  return null;
}

/**
 * 사람이 확인한 복원을 제출한다. 계획의 `target`·`content_hash`로 결정 handle을 발급하고,
 * 같은 handle의 `restore_backup` 결정으로 `restore_request`를 보낸다. 결과는
 * `restore_result` 또는 `restore_failed`다. 복원 뒤 core는 같은 pipe의 새 hello로 다시
 * 시작하므로 결과를 받은 뒤 connection이 session을 다시 연다.
 */
export function submitRestore(
  pipe: RestorePipe,
  issue: IssueRestoreHandle,
  input: {
    readonly createdAt: string;
    readonly target: string;
    readonly contentHash: string;
  },
  clock: RestoreClock = realClock,
  replyMs: number = RESTORE_RUN_REPLY_MS,
): Promise<RestoreSubmitReply> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RestoreSubmitReply) => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      off();
      resolve(value);
    };
    const off = pipe.onMessage((payload) => {
      const message = payload as {
        type?: unknown;
        created_at?: unknown;
        restored_through_seq?: unknown;
        previous_through_seq?: unknown;
        stage?: unknown;
        code?: unknown;
        message?: unknown;
        restarted?: unknown;
      };
      if (
        message.type === "restore_result" &&
        message.created_at === input.createdAt
      ) {
        if (typeof message.restored_through_seq !== "string") {
          finish({
            ok: false,
            code: "internal",
            message: "복원 결과를 읽지 못했다",
            restarted: true,
          });
          return;
        }
        finish({
          ok: true,
          created_at: input.createdAt,
          restored_through_seq: message.restored_through_seq,
          previous_through_seq: typeof message.previous_through_seq === "string"
            ? message.previous_through_seq
            : null,
          restarted: true,
        });
        return;
      }
      if (
        message.type === "restore_failed" &&
        message.stage === "restore" &&
        message.created_at === input.createdAt
      ) {
        finish({
          ok: false,
          code: String(message.code ?? "internal"),
          message: String(message.message ?? ""),
          restarted: message.restarted === true,
        });
      }
    });
    const timer = clock.setTimeout(
      () =>
        finish({
          ok: false,
          code: "unavailable",
          message: "복원 결과의 응답이 없다",
          restarted: true,
        }),
      replyMs,
    );
    void (async () => {
      const issued = await issue({
        target: input.target,
        contentHash: input.contentHash,
        windowId: RESTORE_WINDOW_ID,
      });
      if (!issued.ok) {
        finish({
          ok: false,
          code: "unavailable",
          message: "확인 handle을 받지 못했다",
          restarted: false,
        });
        return;
      }
      const sent = pipe.restore({
        type: "restore_request",
        created_at: input.createdAt,
        confirmation: issued.confirmation,
      });
      if (!sent) {
        finish({
          ok: false,
          code: "unavailable",
          message: "core가 준비되지 않았다",
          restarted: false,
        });
      }
    })();
  });
}

export type { MainHello };
