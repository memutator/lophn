import {
  WORKSPACE_LAYOUT_READ_CHANNEL,
  WORKSPACE_LAYOUT_SAVE_CHANNEL,
  type WorkspaceLayoutReadResult,
  type WorkspaceLayoutSaveResult,
} from "../ipc/workspace.ts";

interface LayoutTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

/** 작업대 layout 통로. 탭과 정보 패널만 보내고 main이 다시 검사한다. */
interface LophnLayoutApi {
  readWorkspace(input: {
    workspace: string;
  }): Promise<WorkspaceLayoutReadResult>;
  saveWorkspace(input: {
    workspace: string;
    layout: unknown;
  }): Promise<WorkspaceLayoutSaveResult>;
}

export function createLayoutApi(transport: LayoutTransport): LophnLayoutApi {
  return Object.freeze({
    readWorkspace: async (input) => {
      try {
        return (await transport.invoke(
          WORKSPACE_LAYOUT_READ_CHANNEL,
          input,
        )) as WorkspaceLayoutReadResult;
      } catch {
        return { ok: false, code: "unavailable", message: "" };
      }
    },
    saveWorkspace: async (input) => {
      try {
        return (await transport.invoke(
          WORKSPACE_LAYOUT_SAVE_CHANNEL,
          input,
        )) as WorkspaceLayoutSaveResult;
      } catch {
        return { ok: false, code: "unavailable", message: "" };
      }
    },
  } satisfies LophnLayoutApi);
}
