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

// 숨긴 tool의 정의를 불러온다. 이 tool은 이름만 확인하고, 정의는 packer가 결과 자리에 펼친다(native는 tool reference,
// 그 밖은 정의 글). 항목이 맞는 것은 이 session의 숨긴 목록(ctx.deferred)에 든 tool뿐이라 session 목록과 할당 밖 tool은
// 펼 수 없다. 설명 끝에는 prepare가 그 session의 숨긴 wire 이름과 짧은 안내를 이름 순으로 붙인다.
export const TOOL_LOAD_DESCRIPTION =
  "Load the definitions of tools listed below by name only, before calling them; load a tool first when an instruction or a skill tells you to use it. Each name is a wire name, or the start of several wire names that loads the whole group: a name matches the tools whose wire name equals it or starts with it and an underscore (examples: job, release, an app's domain name, mcp__<server>). Load every group a task needs in one call. Tools known by name only:";

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
  // 정의를 tools[]에 싣지 않은 tool을 일반 tool calling으로 부르는 진입점이다. loop가 기록·Gate·retry 전에 대상 tool의
  // 호출로 풀어(`dispatchTarget`) 이 handler에는 오지 않는다. 대상도 tool_call인 호출만 여기 와서 거절된다.
  defineTool({
    name: "tool.call",
    input: z.strictObject({
      name: z.string().min(1),
      input: z.record(z.string(), z.unknown()).optional(),
    }),
    routes: [],
    description:
      "Call a tool loaded with tool_load: name is its wire name and input its arguments. Tools whose definitions are listed can be called directly.",
    effect: "read",
    handler: () => Promise.resolve(invalid("tool_call cannot call tool_call")),
  }),
];
