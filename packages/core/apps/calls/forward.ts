import type { Result } from "../../../base/mod.ts";
import type { ToolCallOutput } from "../../../protocol/apps/calls/mod.ts";
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { VerifiedCaller } from "./caller.ts";

// 다른 기계의 앱 command를 부르는 길. 부른 쪽 확인과 target 검사가 끝난 호출만 온다(`remote` caller가 아닌 agent와 앱).
// 그 기계로 넘기고 받은 답을 돌려주는 것은 remote wiring이 낸다.
export type RemoteForward = (call: {
  caller: Extract<VerifiedCaller, { kind: "agent" | "app" }>;
  target: { machine: string; app: Id<"app"> };
  name: string;
  input: JsonValue | undefined;
}) => Promise<Result<ToolCallOutput>>;
