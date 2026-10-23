import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import {
  defineTool,
  fitted,
  invalid,
  notFound,
  type ToolDefinition,
} from "../spi.ts";
import { toolForWireName } from "../wire.ts";

// 숨긴 tool을 불러온다. 정의는 provider가 tool reference로 펼치고 이 tool은 이름만 확인한다.
// 받는 이름은 이 session의 숨긴 목록(ctx.deferred)에 있는 것뿐이라 session 목록과 할당 밖 tool은 펼 수 없다.
export const TOOL_LOAD_DESCRIPTION =
  "Load tools whose definitions are not listed yet. These tools are known by name only: load them with this tool before calling them, and load a tool first when an instruction or a skill tells you to use it. Names are the wire names of the tools. Not yet loaded tools:";

export const TOOL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "tool.load",
    input: z.strictObject({ names: z.array(z.string().min(1)).min(1).max(20) }),
    routes: [],
    description: TOOL_LOAD_DESCRIPTION,
    effect: "read",
    handler: (input, ctx) => {
      // 하나라도 틀리면 전체가 실패한다.
      for (const name of input.names) {
        const found = toolForWireName(ctx.listed, name);
        if (found === undefined) return Promise.resolve(notFound(name));
        if (!ctx.deferred.has(found.name)) {
          return Promise.resolve(
            invalid(`${name} is already loaded; call it directly`),
          );
        }
      }
      return Promise.resolve(ok(
        fitted(`loaded ${input.names.length} tools`, {
          tool_reference: input.names,
        }),
      ));
    },
  }),
];
