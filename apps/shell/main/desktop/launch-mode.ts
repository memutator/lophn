// 창 없는 시작 intent(desktop#R21). 로그인 자동 시작은 `--tray`로 main만 띄운다.
// argv에서 읽는 것은 `--tray`뿐이고 나머지 값은 실행 권한으로 해석하지 않는다.

/** launcher가 첫 argv에 창 없는 시작을 요청할 때 쓰는 실행 intent. */
export const TRAY_INTENT = "--tray";

export type LaunchMode = {
  /** true면 main과 core만 띄우고 창을 열지 않는다. */
  tray: boolean;
};

export interface LaunchModeInput {
  argv?: readonly string[];
}

/** argv에 `--tray`가 있으면 창 없는 시작이다. 다른 값은 보지 않는다. */
export function resolveLaunchMode(
  input: LaunchModeInput | readonly string[] = {},
): LaunchMode {
  // 빈 입력은 프로세스 argv로 폴백한다.
  const argv = isArgvList(input) ? input : input.argv ?? process.argv;
  return { tray: argv.includes(TRAY_INTENT) };
}

function isArgvList(
  input: LaunchModeInput | readonly string[],
): input is readonly string[] {
  // 문자열 배열은 `argv`가 없다. 입력 객체가 argv를 가지면 객체다.
  if ("argv" in input) return false;
  // 배열 이외의 입력 객체는 argv가 없어도 객체다.
  return Array.isArray(input) &&
    input.every((item) => typeof item === "string");
}

export interface RunningNoticeTarget {
  /** 이미 실행 중임을 알린다. 있다면 OS notification 자리다. */
  show(title: string, body: string): void;
}

export interface RunningNoticeOptions {
  /** notification이 없을 때 이유만 log로 남긴다. */
  show?: (title: string, body: string) => void;
  log?: (message: string) => void;
}

const TITLE = "lophn";
const BODY = "이미 실행 중입니다";

/** 같은 데이터 root에 main이 이미 있을 때 실행 중이라고 알리고 끝난다(platform#R10). */
export function notifyAlreadyRunning(options: RunningNoticeOptions = {}): void {
  const show = options.show;
  if (show === undefined) {
    (options.log ?? defaultLog)(
      "notification이 없어 실행 중 안내를 log로 남긴다",
    );
    return;
  }
  show(TITLE, BODY);
}

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
