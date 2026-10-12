import {
  RESTORE_CANCEL_CHANNEL,
  RESTORE_PLAN_CHANNEL,
  RESTORE_SUBMIT_CHANNEL,
  type RestorePlanInput,
  type RestorePlanReply,
  type RestoreSubmitInput,
  type RestoreSubmitReply,
} from "../ipc/restore.ts";

export interface RestoreTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

/** settings backup 복원 통로(shell#T58). 묶음 하나만 보내고 main이 다시 검사한다. */
export interface LophnRestoreApi {
  plan(input: RestorePlanInput): Promise<RestorePlanReply>;
  submit(input: RestoreSubmitInput): Promise<RestoreSubmitReply>;
  /** 확인 자리를 닫았다. main이 그 묶음의 계획을 버린다. */
  cancel(input: RestorePlanInput): Promise<void>;
}

export function createRestoreApi(transport: RestoreTransport): LophnRestoreApi {
  return Object.freeze(
    {
      plan: async (input) => {
        try {
          return await transport.invoke(
            RESTORE_PLAN_CHANNEL,
            input,
          ) as RestorePlanReply;
        } catch {
          return { ok: false, code: "unavailable", message: "" };
        }
      },
      cancel: async (input) => {
        try {
          await transport.invoke(RESTORE_CANCEL_CHANNEL, input);
        } catch {
          // 닫기는 늘 성공으로 본다. main이 없으면 버릴 계획도 없다.
        }
      },
      submit: async (input) => {
        try {
          return await transport.invoke(
            RESTORE_SUBMIT_CHANNEL,
            input,
          ) as RestoreSubmitReply;
        } catch {
          return {
            ok: false,
            code: "unavailable",
            message: "",
            restarted: false,
          };
        }
      },
    } satisfies LophnRestoreApi,
  );
}
