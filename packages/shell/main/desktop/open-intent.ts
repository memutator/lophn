// 창 열기 intent. OS가 넘기는 실행 인자에서 읽는 것은 `--quit`, `--open-app <app ID>`,
// `--harness-gui <harness> --cwd <dir> [--resume <id>]` 셋뿐이다. 모양이 조금이라도 다르면 아무 대상도
// 열지 않고 기본 창 요청으로 읽는다. 앱 코드·token·port는 받을 자리가 없다. 경로는 harness-gui의 `--cwd`
// 하나만 받는데, 절대 경로 모양만 보고(파서) 있는 폴더인지는 여는 쪽이 본다. 모양은 node test가 zod를 풀지
// 못해 여기서 정규식으로 본다.
import { isAbsolute } from "node:path";

import {
  type HarnessGuiOpen,
  isGuiHarness,
} from "../../../protocol/extensions/acp-session.ts";

export const OPEN_APP_FLAG = "--open-app";
export const HARNESS_GUI_FLAG = "--harness-gui";
export const CWD_FLAG = "--cwd";
export const RESUME_FLAG = "--resume";
const QUIT_FLAG = "--quit";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const APP_ID = new RegExp(`^app_${ULID}$`);

export type OpenIntent =
  /** 대상 없는 새 기본 창. */
  | { kind: "window" }
  /** 창 없는 종료 요청. */
  | { kind: "quit" }
  /** 그 앱의 전용 창. */
  | { kind: "app"; app: string }
  /** extension harness-gui의 CLI 화면 창. */
  | ({ kind: "harness-gui" } & HarnessGuiOpen);

const WINDOW: OpenIntent = { kind: "window" };

// flag가 정확히 한 번 있고 바로 뒤에 값이 있을 때만 값을 낸다. 없으면 undefined, 틀리면 null이다.
function flagValue(
  argv: readonly string[],
  flag: string,
): string | undefined | null {
  const at = argv.flatMap((arg, index) =>
    arg === flag || arg.startsWith(`${flag}=`) ? [index] : [],
  );
  if (at.length === 0) return undefined;
  const value = argv[at[0]! + 1];
  if (at.length !== 1 || argv[at[0]!] !== flag || value === undefined) {
    return null;
  }
  return value;
}

function readHarnessGui(argv: readonly string[]): OpenIntent {
  const harness = flagValue(argv, HARNESS_GUI_FLAG);
  const cwd = flagValue(argv, CWD_FLAG);
  const resume = flagValue(argv, RESUME_FLAG);
  if (!isGuiHarness(harness)) return WINDOW;
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return WINDOW;
  if (resume === null || (resume !== undefined && resume.startsWith("-"))) {
    return WINDOW;
  }
  return {
    kind: "harness-gui",
    harness,
    cwd,
    ...(resume === undefined || resume === "" ? {} : { resume }),
  };
}

/**
 * 실행 인자(첫 시작의 process.argv, second-instance argv)를 읽는다. Chromium이 덧붙이는
 * switch와 실행 파일 경로는 보지 않는다. 각 flag는 정확히 한 번, 바로 뒤 값이 모양에 맞을
 * 때만 읽는다. 모양이 틀리면 기본 창이다.
 */
export function readOpenIntent(argv: readonly string[]): OpenIntent {
  if (argv.includes(QUIT_FLAG)) return { kind: "quit" };
  if (argv.includes(HARNESS_GUI_FLAG)) return readHarnessGui(argv);
  const app = flagValue(argv, OPEN_APP_FLAG);
  if (typeof app !== "string") return WINDOW;
  return APP_ID.test(app) ? { kind: "app", app } : WINDOW;
}
