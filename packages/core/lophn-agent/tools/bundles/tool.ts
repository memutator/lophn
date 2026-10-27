import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import { toWireToolName } from "../../../../protocol/lophn-agent/tool-catalog.ts";
import {
  defineTool,
  fitted,
  invalid,
  notFound,
  type ToolDefinition,
} from "../spi.ts";

// 숨긴 tool을 불러온다. 정의는 provider가 tool reference로 펼치고 이 tool은 이름만 확인한다.
// 항목이 맞는 것은 이 session의 숨긴 목록(ctx.deferred)에 든 tool뿐이라 session 목록과 할당 밖 tool은 펼 수 없다.
// 설명 끝에는 prepare가 그 session의 숨긴 wire 이름을 정렬해 붙인다.
export const TOOL_LOAD_DESCRIPTION =
  "Load tools whose definitions are not listed yet. These tools are known by name only: load them with this tool before calling them, and load a tool first when an instruction or a skill tells you to use it. Each name is a wire name, or the start of several wire names that loads the whole group: a name matches the tools whose wire name equals it or starts with it and an underscore (examples: job, an app's domain name, mcp__<server>). Tools known by name only:";

export const TOOL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "tool.load",
    input: z.strictObject({ names: z.array(z.string().min(1)).min(1).max(20) }),
    routes: [],
    description: TOOL_LOAD_DESCRIPTION,
    effect: "read",
    handler: (input, ctx) => {
      const wire = (tool: ToolDefinition) => toWireToolName(tool.name);
      const hidden = ctx.listed.filter((tool) => ctx.deferred.has(tool.name));
      const loaded = new Set<string>();
      // 하나라도 틀리면 전체가 실패한다.
      for (const name of input.names) {
        const matched = hidden.filter(
          (tool) => wire(tool) === name || wire(tool).startsWith(`${name}_`),
        );
        if (matched.length === 0) {
          const shown = ctx.listed.some((tool) => wire(tool) === name);
          return Promise.resolve(
            shown
              ? invalid(`${name} is already loaded; call it directly`)
              : notFound(name),
          );
        }
        for (const tool of matched) loaded.add(wire(tool));
      }
      // names는 이력에 앞 turn 호출을 되살릴 때 쓰는 요청 그대로의 입력이다.
      return Promise.resolve(
        ok(
          fitted(`loaded ${loaded.size} tools`, {
            names: input.names,
            tool_reference: [...loaded].sort(),
          }),
        ),
      );
    },
  }),
];
