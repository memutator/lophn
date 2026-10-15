// 결정 handle IPC. 일반 shell 창 본문만 부를 수 있다. 보호 창·overlay·앱 view는 창이 아니므로
// 받지 못한다. 요청은 결정 이름과 대상뿐이고 결과에는 handle 참조와 기한만 있다.
import {
  DECISION_HANDLE_CHANNEL,
  type DecisionHandleReply,
  decisionHandleRequestSchema,
} from "../../ipc/confirmation.ts";
import type { DecisionCore } from "./core.ts";
import { issueDecisionHandle } from "./issue.ts";

export interface DecisionHandleIpc {
  handle(
    channel: string,
    listener: (
      event: { readonly sender: unknown },
      input: unknown,
    ) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

function error(code: string, message: string): DecisionHandleReply {
  return { error: { code, message } };
}

export function registerDecisionHandle(
  ipc: DecisionHandleIpc,
  deps: {
    /** IPC를 보낸 webContents가 일반 shell 창 본문이면 그 창의 ref. 아니면 undefined다. */
    windowOf(sender: unknown): string | undefined;
    core(): DecisionCore | null;
    register: Parameters<typeof issueDecisionHandle>[0]["register"];
    now(): number;
  },
): void {
  ipc.handle(DECISION_HANDLE_CHANNEL, async (event, input) => {
    const windowId = deps.windowOf(event.sender);
    if (windowId === undefined) {
      return error("forbidden", "이 창에서는 받을 수 없다");
    }
    const parsed = decisionHandleRequestSchema.safeParse(input);
    if (!parsed.success) return error("invalid_input", "결정 요청이 아니다");
    const core = deps.core();
    if (core === null) return error("unavailable", "core가 준비되지 않았다");
    const issued = await issueDecisionHandle({
      core,
      register: deps.register,
      windowId,
      request: parsed.data,
      nowMs: deps.now(),
    });
    if (!issued.ok) return error(issued.error.code, issued.error.message);
    return { confirmation: issued.confirmation, expires_at: issued.expires_at };
  });
}

export function removeDecisionHandle(ipc: DecisionHandleIpc): void {
  ipc.removeHandler(DECISION_HANDLE_CHANNEL);
}
