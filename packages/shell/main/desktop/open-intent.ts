// 창 열기 intent. OS가 넘기는 실행 인자에서 읽는 것은 `--quit`, `--open-app <app ID>` 둘뿐이다.
// 모양이 조금이라도 다르면 아무 대상도 열지 않고 기본 창 요청으로 읽는다. 앱 코드·경로·token·port는
// 받을 자리가 없다. 모양은 node test가 zod를 풀지
// 못해 여기서 정규식으로 본다.

export const OPEN_APP_FLAG = "--open-app";
const QUIT_FLAG = "--quit";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const APP_ID = new RegExp(`^app_${ULID}$`);

export type OpenIntent =
  /** 대상 없는 새 기본 창. */
  | { kind: "window" }
  /** 창 없는 종료 요청. */
  | { kind: "quit" }
  /** 그 앱의 전용 창. */
  | { kind: "app"; app: string };

const WINDOW: OpenIntent = { kind: "window" };

/**
 * 실행 인자(첫 시작의 process.argv, second-instance argv)를 읽는다. Chromium이 덧붙이는
 * switch와 실행 파일 경로는 보지 않는다. `--open-app`은 정확히 한 번, 바로 뒤 값이 앱 ID일
 * 때만 읽는다. 모양이 틀리면 기본 창이다.
 */
export function readOpenIntent(argv: readonly string[]): OpenIntent {
  if (argv.includes(QUIT_FLAG)) return { kind: "quit" };
  const flags = argv.flatMap((arg, index) =>
    arg === OPEN_APP_FLAG || arg.startsWith(`${OPEN_APP_FLAG}=`) ? [index] : []
  );
  if (flags.length !== 1) return WINDOW;
  const app = argv[flags[0]! + 1];
  if (argv[flags[0]!] !== OPEN_APP_FLAG || app === undefined) return WINDOW;
  return APP_ID.test(app) ? { kind: "app", app } : WINDOW;
}
