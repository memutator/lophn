// 앱 view의 처리되지 않은 오류 전달. 설치 preload가 내부
// `app:view-error`로 `{observation, name, message}`만 보내고, 앱·release·mode·view 연결은
// main이 IPC를 보낸 실제 view에서 정해 붙인다. 페이지는 자기가 어느 앱인지 모르고, 앱·release·mode는
// main이 정한다. 모르는 field가 있는 메시지는 버린다. 깨진 페이지가 오류를 쏟아도 view마다 창당 상한까지만
// 보낸다. 원문은 core가 그 앱 log에 쓰고 main log에는 개수와 view 참조만 남긴다.
import type { ConnectTarget } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

// 깨진 페이지가 오류를 쏟아도 앱 log를 채우지 않게 view마다 창당 상한을 둔다.
const VIEW_ERRORS_PER_WINDOW = 20;
const VIEW_ERROR_WINDOW_MS = 60_000;
// 한 메시지의 글자 상한. `appLogViewError` 입력 상한과 같은 값이다.
const VIEW_ERROR_NAME_MAX_CHARS = 256;
const VIEW_ERROR_MESSAGE_MAX_CHARS = 16_384;

const OBSERVATIONS: readonly string[] = [
  "error",
  "unhandledrejection",
  "render_error",
];

type ViewErrorObservation =
  | "error"
  | "unhandledrejection"
  | "render_error";

function checkViewError(value: unknown):
  | { observation: ViewErrorObservation; name: string; message: string | null }
  | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "message,name,observation") {
    return undefined;
  }
  if (
    !OBSERVATIONS.includes(input.observation as string) ||
    typeof input.name !== "string" || !/\S/.test(input.name) ||
    input.name.length > VIEW_ERROR_NAME_MAX_CHARS ||
    !(input.message === null ||
      (typeof input.message === "string" &&
        input.message.length <= VIEW_ERROR_MESSAGE_MAX_CHARS))
  ) {
    return undefined;
  }
  return input as {
    observation: ViewErrorObservation;
    name: string;
    message: string | null;
  };
}

/** core `app.log_view_error` 입력. 앱·release·mode는 sender view에서 정한 값이다. */
interface ViewErrorForward {
  app: string;
  release: string | null;
  mode: ConnectTarget["mode"];
  observation: ViewErrorObservation;
  name: string;
  message: string | null;
}

interface ViewErrorDeps {
  /** 인증된 client로 core에 보낸다. 받지 못했으면 false다. */
  send(forward: ViewErrorForward): Promise<boolean>;
  clock: { nowMs(): number };
  log(line: string): void;
}

export function createViewErrors(deps: ViewErrorDeps) {
  const windows = new Map<string, { start: number; count: number }>();

  function admit(view_session: string): boolean {
    const now = deps.clock.nowMs();
    const current = windows.get(view_session);
    if (current === undefined || now - current.start >= VIEW_ERROR_WINDOW_MS) {
      windows.delete(view_session);
      windows.set(view_session, { start: now, count: 1 });
      // 닫힌 view의 창은 오래된 것부터 버린다.
      if (windows.size > 256) {
        const oldest = windows.keys().next();
        if (!oldest.done) windows.delete(oldest.value);
      }
      return true;
    }
    current.count += 1;
    return current.count <= VIEW_ERRORS_PER_WINDOW;
  }

  return {
    /** `app:view-error` 하나. 응답은 없다(preload는 보내기만 한다). */
    async observe(view: BoundView, value: unknown): Promise<void> {
      // 상한은 깨진 메시지에도 센다. 넘친 뒤에는 log도 남기지 않는다.
      if (!admit(view.view_session)) return;
      const where = `view ${view.view_session} generation=${view.generation}`;
      const input = checkViewError(value);
      if (input === undefined) {
        deps.log(`${where} view-error dropped reason=invalid`);
        return;
      }
      const forward: ViewErrorForward = {
        app: view.target.app,
        release: view.binding.release,
        mode: view.target.mode,
        observation: input.observation,
        name: input.name,
        message: input.message,
      };
      let sent = false;
      try {
        sent = await deps.send(forward);
      } catch {
        sent = false;
      }
      deps.log(
        `${where} view-error ${input.observation} app=${view.target.app} ` +
          `mode=${view.target.mode}${sent ? "" : " unsent"}`,
      );
    },
  };
}
