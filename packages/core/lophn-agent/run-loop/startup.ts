import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import { eventsList } from "../../../protocol/events/mod.ts";
import type { ParentMessage } from "../../../protocol/supervision/mod.ts";

// runtime 기동 순서(architecture §2.1): bootstrap·machine credential 수신 → core read 연결
// → event cursor 조회. 그 뒤의 복구·selector는 나중 작업이다.
export type CoreRead = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;

export type Startup = {
  coreEpoch: string;
  apiPort: number;
  // hello의 machine credential. 값은 여기만 있고 진단에는 나가지 않는다.
  credential: string;
  // events/list가 보고한 head. 이후 구독의 시작 위치다.
  eventCursor: string;
};

export type StartupInput = {
  hello: Extract<ParentMessage, { type: "hello" }>;
  // core loopback read. credential 부착은 호출자가 한다.
  read: CoreRead;
};

const AGENT_RUNTIME_KIND = "lophn-agent/runtime";

export async function startRuntime(
  input: StartupInput,
): Promise<Result<Startup>> {
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
  // 연결 자체는 read 한 번으로 확인한다. 값은 업무 결정 근거가 아니라 cursor 위치다.
  const listed = await input.read("/v1/events/list", {
    after_seq: "0",
    limit: 1,
  });
  if (!listed.ok) return listed;
  const parsed = eventsList.output.safeParse(listed.value);
  if (!parsed.success) {
    return err({ code: "unavailable", message: "event cursor를 읽지 못했다" });
  }
  return ok({
    coreEpoch: hello.core_epoch,
    apiPort: hello.api_port,
    credential: hello.credential,
    eventCursor: parsed.data.head_seq,
  });
}
