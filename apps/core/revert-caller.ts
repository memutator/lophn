// 앱 revert 호출 worker의 core 쪽 연결(lophn-agent/revert). 제품 core가 감독하는 상시 worker kind
// `apps/revert`의 launch spec과, 사람의 `RunAppRevert`가 단계마다 호출을 청하는 통로다.
// worker의 실제 호출(`apps/connect` 연결과 앱 direct socket)은 apps/worker/apps/revert.ts가 하고,
// core는 호출자의 credential을 요청에 실어 보내고 worker가 돌려준 결과를 받아 판정한다.
// worker는 자기 machine credential이 없어 호출자 주장을 대신하지 않는다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { type AppRevertBinding } from "../../packages/protocol/lophn-agent/mod.ts";
import type { KindLaunchSpec } from "../../packages/protocol/server/mod.ts";
import type { AppStepResult } from "../../packages/core/lophn-agent/session/rewind/mod.ts";
import { allSlotSockets } from "../../packages/core/apps/runtime/processes/mod.ts";
import { checkLaunchSpec } from "../../packages/core/supervision/security/mod.ts";
import type { DocumentsChannel } from "./documents-serving.ts";

export const REVERT_WORKER_KIND = "apps/revert";
// worker 호출 요청 op. apps/worker/apps/revert.ts와 같은 값이다.
export const REVERT_CALL_OP = "revert.call";

// 호출 요청 하나의 기한. 앱 invoke(앱 handler의 write)를 넉넉히 덮는다.
const REVERT_CALL_MS = 60_000;

// worker는 core loopback과 앱 direct socket 자리에만 닿는다. ledger·blob·source를 열지 않는다.
// 앱 socket 자리의 정확한 경로가 필요하다(Deno net 허락은 폴더 prefix를 받지 않는다).
export function revertWorkerSpec(
  input: { socketRoot: string },
): KindLaunchSpec {
  const spec: KindLaunchSpec = {
    kind: REVERT_WORKER_KIND,
    entry: new URL("../worker/apps/revert.ts", import.meta.url).pathname,
    allow_read: [],
    allow_write: [],
    allow_net: [
      "127.0.0.1",
      ...allSlotSockets(input.socketRoot).map((path) => `unix:${path}`),
    ],
    allow_run: [],
    allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "always",
    memory_limit_bytes: 134_217_728,
  };
  const checked = checkLaunchSpec(spec);
  // 위임 없는 이 조립의 고정 spec이라 어긋나면 조립이 아니라 검사의 결함이다.
  if (!checked.ok) throw new Error(checked.error.message);
  return checked.value;
}

// worker 응답을 호출 결과로 옮긴다. 어긋난 모양은 failure다.
function shapeOf(value: unknown): Result<AppStepResult> {
  if (typeof value !== "object" || value === null) {
    return err({ code: "unavailable", message: "app revert call failed" });
  }
  const record = value as Record<string, unknown>;
  const result = record["result"];
  const invocation = record["invocation"];
  return ok({
    result: result === "restored" || result === "uncertain"
      ? result
      : "failure",
    invocation: typeof invocation === "string" ? invocation : null,
  });
}

// 사람의 RunAppRevert가 단계마다 worker에게 호출을 청하는 호출자다. 호출자의 credential을
// 요청에 싣는다(worker가 그 token으로 apps/connect를 다시 연다). credential이 없거나
// worker에 닿지 못하면 failure다. core가 그 결과를 그대로 기록한다.
export function workerAppCaller(options: {
  channel: DocumentsChannel;
  credential: string | undefined;
}): (binding: AppRevertBinding) => Promise<AppStepResult> {
  if (options.credential === undefined) {
    return () => Promise.resolve({ result: "failure", invocation: null });
  }
  const channel = options.channel;
  const credential = options.credential;
  return async (binding) => {
    const answered = await channel.request(
      REVERT_CALL_OP,
      { credential, binding },
      REVERT_CALL_MS,
    );
    if (!answered.ok) {
      return { result: "failure", invocation: null };
    }
    const shaped = shapeOf(answered.value);
    return shaped.ok ? shaped.value : { result: "failure", invocation: null };
  };
}
