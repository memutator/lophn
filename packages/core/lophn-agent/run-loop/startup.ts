import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import type { ParentMessage } from "../../../protocol/supervision/mod.ts";

// runtime 기동 순서: bootstrap·machine credential 수신 → 끝. 켜질 때 돌던 turn은 core가 interrupted로
// 닫으므로(`interruptRunningTurns`) runtime은 이을 것이 없다.
export type CoreRead = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;

export type Startup = {
  coreEpoch: string;
  apiPort: number;
  // hello의 machine credential. 값은 여기만 있고 진단에는 나가지 않는다.
  credential: string;
  // 옛 events/list head 자리다. Bus 구독으로 바뀔 때까지 provider watch가 읽는 값이고 늘 "0"이다.
  eventCursor: string;
};

export type StartupInput = {
  hello: Extract<ParentMessage, { type: "hello" }>;
  // core loopback read. credential 부착은 호출자가 한다. 기동 자체는 읽지 않는다.
  read?: CoreRead;
};

const AGENT_RUNTIME_KIND = "lophn-agent/runtime";

export function startRuntime(input: StartupInput): Result<Startup> {
  const hello = input.hello;
  if (hello.kind !== AGENT_RUNTIME_KIND) {
    return err({
      code: "invalid_input",
      message: "agent runtime hello가 아니다",
    });
  }
  if (hello.credential.length === 0) {
    return err({ code: "unauthorized", message: "machine credential이 없다" });
  }
  return ok({
    coreEpoch: hello.core_epoch,
    apiPort: hello.api_port,
    credential: hello.credential,
    eventCursor: "0",
  });
}
