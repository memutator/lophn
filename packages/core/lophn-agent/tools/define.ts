import type { z } from "zod";
import type { ToolCallHandler, ToolDefinition } from "./registry.ts";

type ToolSpec = {
  name: string;
  description: string;
  effect: ToolDefinition["effect"];
  input: z.ZodType;
  // handler가 core에 부르는 route(helper가 부르는 것도 포함)다. 빠지면 command가 credential 상한에서 forbidden이다.
  routes: readonly { name: string }[];
  handler: ToolCallHandler;
  // Gate가 걸리는 tool만 준다.
  gate?: ToolDefinition["gate"];
};

// 내장 tool 정의다. operations는 routes의 이름이다.
export function defineTool(spec: ToolSpec): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    effect: spec.effect,
    origin: "builtin",
    handler: spec.handler,
    ...(spec.gate === undefined ? {} : { gate: spec.gate }),
    operations: spec.routes.map((route) => route.name),
  };
}
