// shell renderer의 artifact 탭 IPC. 매 요청마다 sender가 살아 있는 desktop 창 main frame인지,
// 입력이 schema에 맞는지 본다. 창은 sender에서 main이 정한다. view의 bounds·숨기기·폐기는
// 앱 view와 같은 길(view-ipc.ts)을 쓴다.
import {
  ARTIFACT_DELETE_CHANNEL,
  ARTIFACT_LIST_CHANNEL,
  ARTIFACT_OPEN_CHANNEL,
  ARTIFACT_RELOAD_CHANNEL,
  type ArtifactListItem,
  artifactDeleteSchema,
  artifactListSchema,
  artifactOpenSchema,
  artifactReloadSchema,
  type ArtifactReply,
  type ArtifactViewState,
} from "../../ipc/artifact.ts";
import {
  type CallerContents,
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import {
  type ArtifactWorkspace,
  artifactWorkspaceOf,
} from "../../../protocol/projects/artifact.ts";
import type { ArtifactViews } from "./registry.ts";

interface ArtifactIpcDeps {
  registry: ContentsRegistry;
  /** sender webContents가 본문인 창. desktop 창이 아니면 undefined다. */
  windowOf(sender: CallerContents): string | undefined;
  views: Pick<ArtifactViews, "open" | "reload">;
  list(
    workspace: ArtifactWorkspace,
    machine?: string,
  ): Promise<ArtifactListItem[]>;
  /** project의 artifact 폴더를 지우고 그 폴더를 연 view를 버린다. */
  remove(input: {
    project: string;
    name: string;
  }): Promise<ArtifactReply<null>>;
}

interface ArtifactIpcHandlers {
  open(
    event: IpcEvent,
    input: unknown,
  ): Promise<ArtifactReply<ArtifactViewState>>;
  reload(event: IpcEvent, input: unknown): Promise<ArtifactReply<null>>;
  list(
    event: IpcEvent,
    input: unknown,
  ): Promise<ArtifactReply<{ artifacts: ArtifactListItem[] }>>;
  delete(event: IpcEvent, input: unknown): Promise<ArtifactReply<null>>;
}

const DESKTOP_HOST = "desktop";

export function createArtifactIpc(deps: ArtifactIpcDeps): ArtifactIpcHandlers {
  function callerWindow(event: IpcEvent): ArtifactReply<string> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    const window =
      caller.value.origin.host === DESKTOP_HOST
        ? deps.windowOf(event.sender)
        : undefined;
    if (window === undefined) {
      return {
        ok: false,
        error: { code: "forbidden", message: "caller is not a desktop window" },
      };
    }
    return { ok: true, value: window };
  }

  return {
    async open(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return window;
      const checked = checkInput(artifactOpenSchema, input);
      if (!checked.ok) return checked;
      return await deps.views.open(window.value, checked.value.source);
    },
    reload(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return Promise.resolve(window);
      const checked = checkInput(artifactReloadSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.views.reload(window.value, checked.value.view_session),
      );
    },
    async list(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return window;
      const checked = checkInput(artifactListSchema, input);
      if (!checked.ok) return checked;
      return {
        ok: true,
        value: {
          artifacts: await deps.list(
            artifactWorkspaceOf(checked.value),
            checked.value.machine,
          ),
        },
      };
    },
    async delete(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return window;
      const checked = checkInput(artifactDeleteSchema, input);
      if (!checked.ok) return checked;
      return await deps.remove(checked.value);
    },
  };
}

interface ArtifactIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [ARTIFACT_OPEN_CHANNEL, "open"],
  [ARTIFACT_RELOAD_CHANNEL, "reload"],
  [ARTIFACT_LIST_CHANNEL, "list"],
  [ARTIFACT_DELETE_CHANNEL, "delete"],
] as const;

export function registerArtifactIpc(
  ipc: ArtifactIpcMain,
  handlers: ArtifactIpcHandlers,
): void {
  for (const [channel, method] of CHANNELS) {
    ipc.handle(channel, (event, input) => handlers[method](event, input));
  }
}

export function removeArtifactIpc(
  ipc: Pick<ArtifactIpcMain, "removeHandler">,
): void {
  for (const [channel] of CHANNELS) ipc.removeHandler(channel);
}
