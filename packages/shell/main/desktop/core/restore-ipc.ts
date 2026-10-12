// settings backup 복원 통로의 main 쪽(shell#T58을 platform#T54가 제품 조립에 잇는다). desktop 창
// 본문만 부르고, 입력은 묶음 하나(`created_at`)뿐이다. 계획 응답의 `target`·`content_hash`는
// 여기에만 남아 같은 묶음의 제출이 그 값으로 결정 handle을 발급한다. 사람이 본 계획과 다른
// 묶음은 제출하지 못한다. handle 원문·pipe frame은 renderer로
// 나가지 않는다.
import { z } from "zod";

import {
  RESTORE_CANCEL_CHANNEL,
  RESTORE_PLAN_CHANNEL,
  RESTORE_SUBMIT_CHANNEL,
  type RestorePlanReply,
  type RestoreSubmitReply,
} from "../../../ipc/restore.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../ipc-guard.ts";
import {
  type IssuedHandle,
  readRestorePlan,
  RESTORE_DECISION,
  type RestorePipe,
  submitRestore,
} from "./restore.ts";

/** 발급한 handle의 기한. 확인 창 handle과 같은 120초다. */
export const RESTORE_HANDLE_MS = 120_000;

const inputSchema = z.strictObject({ created_at: z.string().min(1) });

export interface RestoreIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

export interface RestoreIpcDeps {
  registry: ContentsRegistry;
  pipe: () => RestorePipe;
  /** connection.registerConfirmation. */
  register: (request: unknown) => Promise<
    | { ok: true; confirmation: string; expiresAt: string }
    | { ok: false }
  >;
  now?: () => number;
}

type Basis = { readonly target: string; readonly contentHash: string };

export function registerRestoreIpc(
  ipc: RestoreIpcMain,
  deps: RestoreIpcDeps,
): void {
  const now = deps.now ?? (() => Date.now());
  // 묶음마다 마지막으로 보인 계획의 기준. 제출은 이 값만 쓴다.
  const plans = new Map<string, Basis>();

  const allowed = (event: IpcEvent): boolean => {
    const caller = checkCaller(deps.registry, event);
    return caller.ok && caller.value.origin.host === "desktop";
  };

  ipc.handle(
    RESTORE_PLAN_CHANNEL,
    async (event, input): Promise<RestorePlanReply> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(inputSchema, input);
      if (!parsed.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      const createdAt = parsed.value.created_at;
      const pipe = deps.pipe();
      plans.delete(createdAt);
      const off = pipe.onMessage((payload) => {
        const message = payload as {
          type?: unknown;
          created_at?: unknown;
          target?: unknown;
          content_hash?: unknown;
        };
        if (
          message.type === "restore_plan" &&
          message.created_at === createdAt &&
          typeof message.target === "string" &&
          typeof message.content_hash === "string"
        ) {
          plans.set(createdAt, {
            target: message.target,
            contentHash: message.content_hash,
          });
        }
      });
      try {
        const reply = await readRestorePlan(pipe, createdAt);
        if (!reply.ok) plans.delete(createdAt);
        return reply;
      } finally {
        off();
      }
    },
  );

  // 확인 자리를 닫으면 계획을 버린다. 취소한 뒤의 제출은 계획 없는 제출과 같다.
  ipc.handle(
    RESTORE_CANCEL_CHANNEL,
    (event, input): Promise<{ ok: boolean }> => {
      if (!allowed(event)) return Promise.resolve({ ok: false });
      const parsed = checkInput(inputSchema, input);
      if (!parsed.ok) return Promise.resolve({ ok: false });
      plans.delete(parsed.value.created_at);
      return Promise.resolve({ ok: true });
    },
  );

  ipc.handle(
    RESTORE_SUBMIT_CHANNEL,
    async (event, input): Promise<RestoreSubmitReply> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "", restarted: false };
      }
      const parsed = checkInput(inputSchema, input);
      if (!parsed.ok) {
        return {
          ok: false,
          code: "invalid_input",
          message: "",
          restarted: false,
        };
      }
      const createdAt = parsed.value.created_at;
      const basis = plans.get(createdAt);
      if (basis === undefined) {
        // 사람이 이 묶음의 계획을 보지 않았다. 확인 없는 복원은 없다.
        return {
          ok: false,
          code: "precondition_failed",
          message: "복원 계획을 먼저 읽어야 한다",
          restarted: false,
        };
      }
      plans.delete(createdAt);
      const issue = async (
        request: {
          readonly target: string;
          readonly contentHash: string;
          readonly windowId: string;
        },
      ): Promise<IssuedHandle> => {
        const issued = await deps.register({
          type: "confirmation_handle_register",
          window_id: request.windowId,
          target_ref: request.target,
          content_hash: request.contentHash,
          allowed_decisions: [RESTORE_DECISION],
          expires_at: new Date(now() + RESTORE_HANDLE_MS).toISOString(),
        });
        return issued.ok
          ? {
            ok: true,
            confirmation: issued.confirmation,
            expiresAt: issued.expiresAt,
          }
          : { ok: false };
      };
      return await submitRestore(deps.pipe(), issue, {
        createdAt,
        target: basis.target,
        contentHash: basis.contentHash,
      });
    },
  );
}

export function removeRestoreIpc(ipc: RestoreIpcMain): void {
  ipc.removeHandler(RESTORE_PLAN_CHANNEL);
  ipc.removeHandler(RESTORE_SUBMIT_CHANNEL);
  ipc.removeHandler(RESTORE_CANCEL_CHANNEL);
}
