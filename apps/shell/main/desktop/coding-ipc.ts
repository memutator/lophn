// coding agent 연결·[Start]의 renderer IPC(shell#T50). desktop 창 본문만 부르고, 호출 이름과 모양을 schema로
// 거른 뒤 연결은 coding-connection이, 시작은 coding-start가 다시 검사한다. 사람이 누른 [Start]가 허락이라서
// 확인 창이 없다. 한 클릭이 일회 handle을 발급하고 곧바로 그 handle로 시작한다.
import {
  CODING_CHANNEL,
  codingCallSchema,
  type CodingReply,
  type FolderChoiceView,
  type SessionView,
  type StartView,
} from "../../ipc/coding.ts";
import type { TerminalRuntime } from "../../ipc/terminal.ts";
import type { CodingConnection } from "./coding-connection.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

// 시작과 관측 표의 모양만 본다. 구현(terminal/coding/coding-start.ts)은 contracts를 읽으므로 shell tsc가 따라가지
// 않게 이 파일은 구조 모양으로만 받는다.
export interface CodingStartPort {
  issue(
    click: unknown,
  ):
    | { ok: true; human_start_handle: string; operation_id: string }
    | { ok: false; reason: "invalid_input"; message: string };
  start(handle: string): Promise<
    | { ok: true; runtime: { terminal_ref: string } }
    | { ok: false; reason: string; message: string; next: string[]; guide?: unknown }
  >;
}

export interface ObservationPort {
  onEvent(event: unknown): void;
  hostLost(): void;
  current(runtime_ref: string): { state: SessionView["tui"] };
}

export interface CodingIpcDeps {
  registry: ContentsRegistry;
  connection: CodingConnection;
  start: CodingStartPort;
  /** 등록된 project 폴더 전부. 사람이 [Start] 앞에서 고른다. */
  folders(): Promise<readonly FolderChoiceView[]>;
  /** lophn이 [Start]로 연 coding TUI와 지금 관측한 상태. */
  sessions(): readonly SessionView[];
}

export interface CodingIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

function refused(
  code: "forbidden" | "invalid_input",
): CodingReply<never> {
  return { ok: false, error: { code, message: "request was refused" } };
}

export function createCodingIpc(deps: CodingIpcDeps) {
  return async (
    event: IpcEvent,
    input: unknown,
  ): Promise<CodingReply<unknown>> => {
    const caller = checkCaller(deps.registry, event);
    // overlay·앱 view는 연결을 만들거나 시작하지 않는다. desktop 창 본문만 연다.
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return refused("forbidden");
    }
    const parsed = checkInput(codingCallSchema, input);
    if (!parsed.ok) return refused("invalid_input");
    const call = parsed.value;
    switch (call.op) {
      case "detect":
        return await deps.connection.detect("detect");
      case "refresh":
        return await deps.connection.detect("refresh");
      case "connect":
        return await deps.connection.connect(call.request);
      case "folders": {
        try {
          return { ok: true, value: await deps.folders() };
        } catch {
          return {
            ok: false,
            error: { code: "unavailable", message: "folders were not read" },
          };
        }
      }
      case "sessions":
        return { ok: true, value: deps.sessions() };
      case "start": {
        const issued = deps.start.issue(call.click);
        if (!issued.ok) return refused("invalid_input");
        const result = await deps.start.start(issued.human_start_handle);
        const view: StartView = result.ok
          ? { ok: true, runtime_ref: result.runtime.terminal_ref }
          : {
            ok: false,
            reason: result.reason,
            next: result.next,
            own_terminal: result.guide !== undefined,
          };
        return { ok: true, value: view };
      }
    }
  };
}

export function registerCodingIpc(
  main: CodingIpcMain,
  handler: ReturnType<typeof createCodingIpc>,
): void {
  main.handle(CODING_CHANNEL, handler);
}

export function removeCodingIpc(main: Pick<CodingIpcMain, "removeHandler">) {
  main.removeHandler(CODING_CHANNEL);
}

/**
 * lophn이 [Start]로 연 coding TUI와 그 지금 상태. TUI 상태는 host가 관측한 값(`observationAt`)이고 Task 상태가
 * 아니다. 관측이 없거나 낡았거나 host가 끝났으면 unknown이다. 일반 shell runtime은 싣지 않는다.
 */
export function codingSessions(
  runtimes: readonly TerminalRuntime[],
  store: Pick<ObservationPort, "current">,
): SessionView[] {
  return runtimes.flatMap((runtime) =>
    runtime.coding === undefined ? [] : [{
      runtime_ref: runtime.terminal_ref,
      ticket: runtime.coding.ticket,
      connection: runtime.coding.connection,
      tui: store.current(runtime.terminal_ref).state,
      prompt_delivery: runtime.coding.prompt_delivery,
    }]
  );
}

type ProjectsReader = {
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<{ ok: boolean; value?: unknown }>;
};

/**
 * 등록된 project 폴더 전부. folder_ref는 terminal·[Start]가 다시 해석하는 규칙(`<project>_<순번>`)과 같다.
 * 읽지 못하면 빈 목록이다(폴더를 지어내지 않는다).
 */
export async function registeredFolders(
  session: ProjectsReader | null,
): Promise<FolderChoiceView[]> {
  if (session === null) return [];
  const reply = await session.call("read", "projects", "list", {
    status: "active",
  });
  if (!reply.ok) return [];
  const projects = (reply.value as {
    projects?: {
      id?: string;
      title?: string;
      folders?: { path: string }[];
    }[];
  } | undefined)?.projects ?? [];
  return projects.flatMap((project) =>
    typeof project.id !== "string"
      ? []
      : (project.folders ?? []).map((folder, index) => ({
        project: project.id as string,
        project_name: project.title ?? "",
        folder_ref: `${project.id}_${index}`,
        path: folder.path,
      }))
  );
}

/**
 * supervisor가 host에서 받은 줄과 host 끝남을 child 등록(coding-children)과 TUI 관측 표(ObservationStore)에
 * 같이 보낸다. 둘 다 같은 줄을 본다: child 줄은 등록기가, observation 줄은 관측 표가 받고 나머지는 무시한다.
 */
export function hostEventSinks(
  registrar: { onEvent(event: unknown): void; hostLost(): void },
  store: Pick<ObservationPort, "onEvent" | "hostLost">,
): { onEvent(event: unknown): void; onHostLost(): void } {
  return {
    onEvent(event) {
      registrar.onEvent(event);
      store.onEvent(event);
    },
    onHostLost() {
      registrar.hostLost();
      store.hostLost();
    },
  };
}
