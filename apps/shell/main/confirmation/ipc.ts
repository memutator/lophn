// 보호 창 IPC 등록. 창 열기는 일반 shell 창만, 표시·제출·취소는 그 보호 창만 부른다.
// 부모는 renderer가 보낸 parentWindow 값이 아니라 IPC를 보낸 창이다. 결과에는 handle·secret
// 값이 없다. 제출 입력(secret 값)은 log·오류에 넣지 않는다.
import {
  CONFIRMATION_CANCEL_CHANNEL,
  CONFIRMATION_DISPLAY_CHANNEL,
  CONFIRMATION_OPEN_CHANNEL,
  CONFIRMATION_SUBMIT_CHANNEL,
  confirmationOpenSchema,
  confirmationSubmitSchema,
} from "../../ipc/confirmation.ts";
import type { Coordinator, Opener } from "./coordinator.ts";
import type { ConfirmationIntent } from "./types.ts";
import type { ParentWindow } from "./window.ts";

export interface ConfirmationIpcEvent {
  readonly sender: Opener & { readonly id: number };
}

export interface ConfirmationIpc {
  handle(
    channel: string,
    listener: (event: ConfirmationIpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

type Failure = { ok: false; error: { code: string; message: string } };

function failure(code: string, message: string): Failure {
  return { ok: false, error: { code, message } };
}

export function registerConfirmationIpc(
  ipc: ConfirmationIpc,
  deps: {
    coordinator: Coordinator;
    /** IPC를 보낸 webContents가 일반 shell 창 본문이면 그 창. 아니면 undefined다. */
    parentOf(event: ConfirmationIpcEvent): ParentWindow | undefined;
  },
): void {
  const windowOf = (event: ConfirmationIpcEvent) =>
    deps.coordinator.windowOf(event.sender.id);

  ipc.handle(CONFIRMATION_OPEN_CHANNEL, async (event, input) => {
    const parent = deps.parentOf(event);
    if (parent === undefined) {
      return { code: "forbidden", message: "이 창에서는 열 수 없다" };
    }
    const parsed = confirmationOpenSchema.safeParse(input);
    if (!parsed.success) {
      return { code: "invalid_input", message: "열기 요청이 아니다" };
    }
    const opened = await deps.coordinator.open({
      intent: parsed.data.request as ConfirmationIntent,
      parent,
      // 끝남 알림은 열기를 보낸 이 창 본문에만 간다. 다른 창은 받지 못한다.
      opener: event.sender,
      requestedByPerson: true,
    });
    if (!opened.ok) return opened.error;
    return {
      windowId: opened.value.windowId,
      displayId: opened.value.displayId,
    };
  });

  // 최신 내용 열기도 이 통로다. 옛 표시가 무효면 정본을 다시 읽어 새 표시를 고정한다.
  ipc.handle(CONFIRMATION_DISPLAY_CHANNEL, async (event) => {
    const windowId = windowOf(event);
    if (windowId === undefined) return failure("forbidden", "보호 창이 아니다");
    await deps.coordinator.settled(windowId);
    const shown = deps.coordinator.display(windowId);
    if (
      shown !== null && shown.state !== "stale" && shown.state !== "expired"
    ) return shown;
    const fresh = await deps.coordinator.refresh(windowId);
    return fresh ?? failure("unavailable", "아직 표시할 내용이 없다");
  });

  ipc.handle(CONFIRMATION_SUBMIT_CHANNEL, async (event, input) => {
    const windowId = windowOf(event);
    if (windowId === undefined) return failure("forbidden", "보호 창이 아니다");
    const parsed = confirmationSubmitSchema.safeParse(input);
    if (!parsed.success) return failure("invalid_input", "제출 모양이 아니다");
    const result = await deps.coordinator.submit({
      windowId,
      displayId: parsed.data.displayId,
      decision: parsed.data.decision,
      ...(parsed.data.input === undefined
        ? {}
        : { commandInput: parsed.data.input }),
      ...(parsed.data.confirmedSecond === undefined
        ? {}
        : { confirmedSecond: parsed.data.confirmedSecond }),
    });
    if (!result.ok) {
      return failure(result.error.code, result.error.message);
    }
    return { outcome: "decided", ...result.value };
  });

  ipc.handle(CONFIRMATION_CANCEL_CHANNEL, async (event) => {
    const windowId = windowOf(event);
    if (windowId === undefined) return failure("forbidden", "보호 창이 아니다");
    return await deps.coordinator.cancel(windowId);
  });
}

export function removeConfirmationIpc(ipc: ConfirmationIpc): void {
  for (
    const channel of [
      CONFIRMATION_OPEN_CHANNEL,
      CONFIRMATION_DISPLAY_CHANNEL,
      CONFIRMATION_SUBMIT_CHANNEL,
      CONFIRMATION_CANCEL_CHANNEL,
    ]
  ) ipc.removeHandler(channel);
}
