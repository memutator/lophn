// 창 열기 intent. OS가 넘기는 실행 인자에서 읽는 것은 `--quit`, `--open-app <app ID>`, `--core`, `--agent-window`, `--page-host`뿐이다. 모양이
// 조금이라도 다르면 아무 대상도 열지 않고 기본 창 요청으로 읽는다. 앱 코드·token·port는 받을 자리가 없다.
// 모양은 node test가 zod를 풀지 못해 여기서 정규식으로 본다.
// `--open-app <app ID>`는 이미 떠 있는 앱의 second-instance argv에서 Chromium이 스위치를 앞에, 값을 뒤에 다시
// 늘어놓아 값이 flag 옆에 남지 않을 수 있지만, OS 바로가기 IPC를 부르는 화면이 아직 없어 그때까지 그대로 둔다.
import {
  AGENT_WINDOW_INTENT,
  CORE_INTENT,
  PAGE_HOST_INTENT,
} from "./launch-mode.ts";

export const OPEN_APP_FLAG = "--open-app";
const QUIT_FLAG = "--quit";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const APP_ID = new RegExp(`^app_${ULID}$`);

export type OpenIntent =
  /** 대상 없는 새 기본 창. */
  | { kind: "window" }
  /** 창 없는 종료 요청. */
  | { kind: "quit" }
  /** core만 ensure하고 끝나는 요청. 창을 열지 않는다. */
  | { kind: "core" }
  /** core가 browser를 쓰려고 띄운 시작. 창이 하나도 없을 때만 focus 없이 창 하나를 연다. */
  | { kind: "agent-window" }
  /** 그 앱의 전용 창. */
  | { kind: "app"; app: string };

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

/**
 * 실행 인자(첫 시작의 process.argv, second-instance argv)를 읽는다. Chromium이 덧붙이는
 * switch와 실행 파일 경로는 보지 않는다. 각 flag는 정확히 한 번, 값이 모양에 맞을
 * 때만 읽는다. 모양이 틀리면 기본 창이다.
 */
export function readOpenIntent(argv: readonly string[]): OpenIntent {
  if (argv.includes(QUIT_FLAG)) return { kind: "quit" };
  if (argv.includes(CORE_INTENT)) return { kind: "core" };
  // 떠 있는 desktop 앱에 core가 page host를 띄우려 했다면 이 앱이 host다. 창을 띄우는 시작과 같게 읽는다.
  if (argv.includes(AGENT_WINDOW_INTENT) || argv.includes(PAGE_HOST_INTENT)) {
    return { kind: "agent-window" };
  }
  const app = flagValue(argv, OPEN_APP_FLAG);
  if (typeof app !== "string") return WINDOW;
  return APP_ID.test(app) ? { kind: "app", app } : WINDOW;
}
