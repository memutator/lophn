import type { z } from "zod";
import type { Result } from "../../../base/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import type { ToolCallHandler, ToolDefinition } from "./registry.ts";
import type { ToolContext } from "./tool-context.ts";

type ToolSpec<I extends z.ZodType> = {
  name: string;
  description: string;
  effect: ToolDefinition["effect"];
  defer?: true;
  input: I;
  // handler가 core에 부르는 route(helper가 부르는 것도 포함)다. 빠지면 command가 credential 상한에서 forbidden이다.
  routes: readonly { name: string }[];
  // 실행기가 `input`으로 이미 검사한 값을 받는다.
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<Result<ToolResult>>;
  // Gate가 걸리는 tool만 준다.
  gate?: (
    input: z.infer<I>,
    ctx: ToolContext,
  ) => ReturnType<NonNullable<ToolDefinition["gate"]>>;
};

// 내장 tool 정의다. operations는 routes의 이름이다.
export function defineTool<I extends z.ZodType>(
  spec: ToolSpec<I>,
): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    effect: spec.effect,
    origin: "builtin",
    ...(spec.defer === undefined ? {} : { defer: true as const }),
    // 실행기가 spec.input으로 검사한 뒤에만 부르므로 입력 type이 맞다.
    handler: spec.handler as ToolCallHandler,
    ...(spec.gate === undefined
      ? {}
      : { gate: spec.gate as ToolDefinition["gate"] }),
    operations: spec.routes.map((route) => route.name),
  };
}
