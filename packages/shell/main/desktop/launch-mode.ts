// 창 없는 시작 intent. 로그인 자동 시작은 `--tray`로 main만 띄운다.
// argv에서 읽는 것은 `--tray`뿐이고 나머지 값은 실행 권한으로 해석하지 않는다.

/** launcher가 첫 argv에 창 없는 시작을 요청할 때 쓰는 실행 intent. */
export const TRAY_INTENT = "--tray";

type LaunchMode = {
  /** true면 main과 core만 띄우고 창을 열지 않는다. */
  tray: boolean;
};

interface LaunchModeInput {
  argv?: readonly string[];
  /**
   * OS가 로그인 항목으로 띄웠는지(macOS). macOS login item은 argv를 넘기지 못해
   * `--tray` 대신 이 값으로 창 없는 시작을 안다.
   */
  openedAtLogin?: boolean;
}

/** argv에 `--tray`가 있으면 창 없는 시작이다. 다른 값은 보지 않는다. */
export function resolveLaunchMode(
  input: LaunchModeInput | readonly string[] = {},
): LaunchMode {
  // 빈 입력은 프로세스 argv로 폴백한다.
  const argv = isArgvList(input) ? input : input.argv ?? process.argv;
  const atLogin = !isArgvList(input) && input.openedAtLogin === true;
  return { tray: atLogin || argv.includes(TRAY_INTENT) };
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

