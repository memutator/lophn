// 시작 intent. `--core`는 core만 ensure하고 끝난다(Windows의 로그인 시작 `Run` 값이 쓴다). `--agent-window`는 창만 다르다(아래).
// 이 모듈이 argv에서 읽는 것은 `--core`뿐이고 나머지 값은 실행 권한으로 해석하지 않는다.

/** launcher가 첫 argv에 core만 띄우는 시작을 요청할 때 쓰는 실행 intent. */
export const CORE_INTENT = "--core";

/**
 * core가 browser를 쓰려고 shell을 띄울 때 쓰는 실행 intent(값은 core와 나누므로 protocol에 있다). 앱은 평소처럼 서고
 * 첫 창을 focus 없이 연다. 이미 떠 있는 앱에는 창이 하나도 없을 때만 창 하나를 같은 모양으로 연다(open-intent.ts, single-instance.ts).
 */
export { AGENT_WINDOW_INTENT } from "../../../protocol/lophn-agent/host-queue.ts";

type LaunchMode = {
  /** true면 창·tray·terminal-host·extension을 조립하지 않고 core만 ensure한다. */
  core: boolean;
};

interface LaunchModeInput {
  argv?: readonly string[];
}

/** argv에 `--core`가 있으면 core만 띄우는 시작이다. 다른 값은 보지 않는다. */
export function resolveLaunchMode(
  input: LaunchModeInput | readonly string[] = {},
): LaunchMode {
  // 빈 입력은 프로세스 argv로 폴백한다.
  const argv = isArgvList(input) ? input : (input.argv ?? process.argv);
  return { core: argv.includes(CORE_INTENT) };
}

function isArgvList(
  input: LaunchModeInput | readonly string[],
): input is readonly string[] {
  // 문자열 배열은 `argv`가 없다. 입력 객체가 argv를 가지면 객체다.
  if ("argv" in input) return false;
  // 배열 이외의 입력 객체는 argv가 없어도 객체다.
  return (
    Array.isArray(input) && input.every((item) => typeof item === "string")
  );
}
