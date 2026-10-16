// 앱 view의 처리되지 않은 오류 전달. 설치 preload가 내부
// `app:view-error`로 `{observation, name, message}`만 보내고, 앱·release·mode·view 연결은
// main이 IPC를 보낸 실제 view에서 정해 붙인다. 페이지가 주장한 앱·release는 받을 자리가 없고
// 모르는 field가 있는 메시지는 버린다. 깨진 페이지가 오류를 쏟아도 view마다 창당 상한까지만
// 보낸다. 원문은 collector의 bounded memory로만 가고 main log에는 개수와 view 참조만 남긴다.
import type { ConnectTarget } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

// contracts/problems REPORTING_LIMITS의 new_reports_per_window·window_ms와 같은 값이다.
const VIEW_ERRORS_PER_WINDOW = 20;
const VIEW_ERROR_WINDOW_MS = 60_000;
// 한 메시지의 글자 상한. 자동 보고 본문 상한(256 KiB) 안에 머문다.
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

/** contracts appViewErrorSchema와 같은 검사. */
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

/** collector `observe-exception` 본문(contracts/problems exceptionObservationInputSchema). */
interface ExceptionObservation {
  report_id: string;
  observed_at: string;
  observation: ViewErrorObservation;
  error: {
    name: string;
    message: string | null;
    message_missing_reason: { reason: string } | null;
    stack: null;
    stack_missing_reason: { reason: string };
  };
  error_missing_reason: null;
  invocation: null;
}

/** 오류를 귀속할 view. registry가 정한 값만 싣는다. binding은 view 식별이다(core route가 칸을 요구한다). */
interface ViewErrorOrigin {
  view_session: string;
  generation: number;
  app: string;
  release: string | null;
  mode: ConnectTarget["mode"];
  bundle_hash: string;
  binding: string;
}

interface ViewErrorForward {
  view: ViewErrorOrigin;
  observation: ExceptionObservation;
}

interface ViewErrorDeps {
  /** 인증된 client로 collector에 보낸다. 받지 못했으면 false다. */
  send(forward: ViewErrorForward): Promise<boolean>;
  ids: { reportId(): string };
  clock: { nowMs(): number; nowIso(): string };
  log(line: string): void;
}

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/** 보고 id(`rpt_` + 소문자 ULID). 시각 48bit와 무작위 80bit(10 byte)다. */
export function reportIdOf(nowMs: number, random: Uint8Array): string {
  let time = "";
  let rest = Math.max(0, Math.floor(nowMs));
  for (let index = 0; index < 10; index++) {
    time = CROCKFORD[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  let bits = 0;
  let value = 0;
  let tail = "";
  for (const byte of random.subarray(0, 10)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      tail += CROCKFORD[(value >> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return `rpt_${time}${tail.padEnd(16, "0")}`;
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
        view: {
          view_session: view.view_session,
          generation: view.generation,
          app: view.target.app,
          release: view.binding.release,
          mode: view.target.mode,
          bundle_hash: view.binding.bundleHash,
          binding: `${view.view_session}#${view.generation}`,
        },
        observation: {
          report_id: deps.ids.reportId(),
          observed_at: deps.clock.nowIso(),
          observation: input.observation,
          error: {
            name: input.name,
            message: input.message,
            message_missing_reason: input.message === null
              ? { reason: "view_message_missing" }
              : null,
            stack: null,
            stack_missing_reason: { reason: "view_stack_not_collected" },
          },
          error_missing_reason: null,
          invocation: null,
        },
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
