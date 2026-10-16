import type { z } from "zod";
import type { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// 실행기가 TOOL_INPUTS로 이미 검사한 입력의 type이다.
export type ToolInput<Name extends keyof typeof TOOL_INPUTS> = z.infer<
  (typeof TOOL_INPUTS)[Name]
>;
