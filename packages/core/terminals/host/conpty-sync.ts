// Windows ConPTY는 앱이 보낸 DEC 2026(synchronized output)을 벗겨 내고, 한 줄·화면 다시 그리기를
// 커서 숨김(?25l)·지우기(2K/K/2J/J)·다시 쓰기·커서 보임(?25h)의 여러 pipe 읽기로 나눠 낸다.
// 조각 사이에서 xterm이 그리면 문장이 깜빡이며 사라졌다가 다시 나타난다.
// ConPTY 다시 그리기 조각을 짧은 상한(24ms) 안에서 하나로 묶고, 앱이 이미 DEC 2026으로 감싼 구간이 아니면
// CSI ?2026h ... CSI ?2026l로 감싸 xterm이 한 frame에 원자적으로 그리게 한다.

const ESC = "\x1b";
const SYNC_BEGIN = `${ESC}[?2026h`;
const SYNC_END = `${ESC}[?2026l`;
const DEFAULT_HOLD_MS = 24;
const DEFAULT_MAX_CHARS = 64 * 1024;
export const DEFAULT_WINDOWS_BUILD = 22621;

/** `os.release()`(예: `10.0.26100`)에서 Windows build 번호를 읽는다. 읽지 못하면 Windows 11 기준값이다. */
export function windowsBuildNumber(release: string): number {
  const parts = release.split(".");
  const build = Number.parseInt(parts[2] ?? "", 10);
  return Number.isFinite(build) && build > 0 ? build : DEFAULT_WINDOWS_BUILD;
}

// chunk 안에 지우기·전체 커서 이동·커서 숨김처럼 다시 그리기가 들어 있는가.
const REDRAW_SEQ = new RegExp(
  `${ESC}\\[(?:\\?25l|\\d*[KJ]|\\d*(?:;\\d*)?[Hf])`,
);
// chunk 끝이 미완성 escape sequence로 잘렸다(다음 pipe 읽기에 이어진다).
const INCOMPLETE_ESC = new RegExp(
  `${ESC}(?:\\[[\\x30-\\x3f]*[\\x20-\\x2f]*)?$`,
);
// 마지막 지우기(2K/K/2J/J) 뒤에 보이는 글자가 아직 오지 않았다(커서 이동·SGR·커서 숨김만 남음).
const TRAILING_ERASE = new RegExp(
  `${ESC}\\[\\d*[KJ](?:${ESC}\\[(?:\\?25l|\\d*(?:;\\d*)?[HfmGABCD]))*$`,
);
// 커서·동기 출력·RIS 순서대로 상태를 따라간다.
const MODE_SEQ = new RegExp(`${ESC}(?:\\[\\?(2026|25)([hl])|c)`, "g");

export interface ConptyFrameBuffer {
  push(chunk: string): void;
  /** 남은 조각을 기다리지 않고 즉시 내보낸다(PTY 종료·정리). */
  drain(): void;
}

export function createConptyFrameBuffer(options: {
  flush(chunk: string): void;
  after(ms: number, run: () => void): () => void;
  holdMs?: number;
  maxChars?: number;
}): ConptyFrameBuffer {
  const holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  let buf = "";
  let cancel: (() => void) | null = null;
  // 앱이 직접 연 DEC 2026 구간 안인가.
  let inAppSync = false;
  // 스트림 기준 커서가 지금 숨겨져 있는가.
  let cursorHidden = false;
  // 이번 buffer에서 커서가 보임 → 숨김으로 바뀌어 아직 다시 보이지 않았다.
  let hidCursorInBuf = false;

  function updateModes(chunk: string): void {
    for (const match of chunk.matchAll(MODE_SEQ)) {
      if (match[0] === `${ESC}c`) {
        inAppSync = false;
        cursorHidden = false;
        hidCursorInBuf = false;
        continue;
      }
      const mode = match[1];
      const set = match[2] === "h";
      if (mode === "2026") {
        inAppSync = set;
      } else if (mode === "25") {
        if (!set) {
          if (!cursorHidden) hidCursorInBuf = true;
          cursorHidden = true;
        } else {
          cursorHidden = false;
          hidCursorInBuf = false;
        }
      }
    }
  }

  function emit(): void {
    if (cancel !== null) {
      cancel();
      cancel = null;
    }
    hidCursorInBuf = false;
    if (buf === "") return;
    const out = buf;
    buf = "";
    const wrapped =
      !inAppSync &&
      !out.includes(SYNC_BEGIN) &&
      !out.includes(SYNC_END) &&
      REDRAW_SEQ.test(out)
        ? `${SYNC_BEGIN}${out}${SYNC_END}`
        : out;
    options.flush(wrapped);
  }

  return {
    push(chunk) {
      if (chunk === "") return;
      updateModes(chunk);
      buf += chunk;
      if (buf.length >= maxChars) {
        emit();
        return;
      }
      const hold =
        hidCursorInBuf ||
        inAppSync ||
        INCOMPLETE_ESC.test(buf) ||
        TRAILING_ERASE.test(buf);
      if (hold) {
        // 첫 보류 시점에 상한 timer를 걸어 계속 숨김·연속 출력에서도 무한히 밀리지 않게 한다.
        cancel ??= options.after(holdMs, emit);
      } else {
        emit();
      }
    },
    drain: emit,
  };
}
