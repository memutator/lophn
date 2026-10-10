// desktop renderer가 지금 창의 작업대 힌트를 main에 보낸다. 창 신원은 main이
// sender로 정하고, 이 통로는 힌트 값만 넘긴다.
import { VIEW_HINT_CHANNEL } from "../ipc/workspace.ts";

export interface WorkspaceHintApi {
  report(hint: unknown): Promise<{ ok: boolean }>;
}

export interface WorkspaceHintTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

export function createWorkspaceHintApi(
  transport: WorkspaceHintTransport,
): WorkspaceHintApi {
  return Object.freeze({
    async report(hint: unknown) {
      try {
        const reply = await transport.invoke(VIEW_HINT_CHANNEL, hint);
        return reply !== null && typeof reply === "object" &&
            (reply as { ok?: unknown }).ok === true
          ? { ok: true }
          : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  });
}
