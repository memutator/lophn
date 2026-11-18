import type { Result } from "../../../base/mod.ts";
import type { ToolCallOutput } from "../../../protocol/apps/calls/mod.ts";
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { VerifiedCaller } from "./caller.ts";

// 다른 기계의 앱 command를 부르는 길. 부른 쪽 확인(verifyCaller)과 target 검사만 끝난 호출이 온다(`remote` caller가 아니고 받은 call을 돌리는 앱도 아닌 agent와 앱).
// Gate는 지나지 않았다. 할당, `app.call` grant, private은 넘기는 쪽이 보내기 전에 본다. 그 기계로 넘기고 받은 답을 돌려주는 것은 remote wiring이 낸다.
export type RemoteForward = (call: {
  caller: Extract<VerifiedCaller, { kind: "agent" | "app" }>;
  target: { machine: string; app: Id<"app"> };
  name: string;
  input: JsonValue | undefined;
}) => Promise<Result<ToolCallOutput>>;
