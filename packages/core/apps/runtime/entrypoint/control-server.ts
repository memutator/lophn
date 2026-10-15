// control socket의 앱 쪽 구현. supervisor만 이 socket을 부르므로 서명·Authorization 검사가 없다.
import { CONTROL_PATHS, PROCESS_PATHS } from "./limits.ts";
import { type HttpHandler, jsonResponse, serveUnix } from "./http.ts";
import { handleControl } from "./control.ts";
import { handleCall } from "./invoke.ts";
import { handleApply } from "./apply.ts";
import type { RuntimeState } from "./state.ts";

// shutdown 요청을 받은 프로세스는 새 호출을 닫은 채 진행 중인 호출이 끝나는 대로 스스로 끝난다.
// 유예(grace_ms)가 지나도 끝나지 않은 호출은 기다리지 않는다. 그래도 끝나지 않으면 supervisor가
// 유예 뒤 강제 종료한다.
function exitWhenIdle(
  state: RuntimeState,
  graceMs: number,
  exit: (code: number) => void,
): void {
  const startedAt = Date.now();
  const tick = () => {
    if (state.running === 0 || Date.now() - startedAt >= graceMs) {
      exit(0);
      return;
    }
    setTimeout(tick, 25);
  };
  // 종료 요청의 응답이 먼저 나가도록 한 걸음 미룬다.
  setTimeout(tick, 50);
}

const CONTROLS: readonly string[] = Object.values(CONTROL_PATHS);

export function startControlServer(
  state: RuntimeState,
  options: { exit?: (code: number) => void } = {},
) {
  const exit = options.exit ?? ((code: number) => Deno.exit(code));
  let exiting = false;
  const handler: HttpHandler = async (request) => {
    const known = request.path === PROCESS_PATHS.call ||
      request.path === PROCESS_PATHS.apply || CONTROLS.includes(request.path);
    if (!known) {
      return jsonResponse(404, {
        error: { code: "not_found", message: "unknown path" },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse(400, {
        error: { code: "invalid_input", message: "control is POST" },
      });
    }
    if (request.path === PROCESS_PATHS.call) {
      const result = await handleCall(state, request.body);
      return jsonResponse(result.status, result.body);
    }
    if (request.path === PROCESS_PATHS.apply) {
      const result = await handleApply(state, request.body);
      return jsonResponse(result.status, result.body);
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(request.body));
    } catch {
      return jsonResponse(400, {
        error: { code: "invalid_input", message: "control body is not JSON" },
      });
    }
    const control = handleControl(state, request.path, body);
    if ("error" in control) {
      return jsonResponse(control.status, { error: control.error });
    }
    if (request.path === CONTROL_PATHS.shutdown && !exiting) {
      exiting = true;
      exitWhenIdle(state, (body as { grace_ms: number }).grace_ms, exit);
    }
    return jsonResponse(control.status, control.body);
  };
  return serveUnix(state.controlSocket, handler);
}
