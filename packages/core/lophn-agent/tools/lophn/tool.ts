import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import { commandsForPlace } from "../../../../cli/commands/mod.ts";
import { helpText } from "../../../../cli/help.ts";
import type { CommandDoc } from "../../../../cli/commands/types.ts";
import { parseCommandLine, wordsOf } from "../../../../cli/parser.ts";
import type { PlaceKind } from "../../../../protocol/lophn-agent/places.ts";
import type { AppCommandEntry } from "../app-tool/command.ts";
import { defineTool } from "../define.ts";
import { fitted, invalid } from "../fit-result.ts";
import type { ToolCallHandler, ToolDefinition } from "../registry.ts";
import { isBuiltinWord } from "./resolve.ts";

// 정의의 이름과 같아야 한다. eval의 tool file 표가 `defineTool({ name: "..."` 글자 그대로 읽어서 정의 쪽은 literal이다.
export const LOPHN_TOOL_NAME = "lophn";

const USAGE =
  'Run one lophn command. args is the command line without the leading "lophn", one word per item: ["job", "list"], ["job", "update", "<job id>", "--every", "2h"]. One command per call: no pipes, no &&, no shell.\n' +
  "Fields are flags: --field-name value (the field field_name); repeat a flag for a list; a boolean is --flag or --no-flag; --input '<JSON object>' sets several fields at once and takes JSON values for fields that need one.\n" +
  'Run ["help"] for the groups, ["<group>", "--help"] for the commands of a group and ["<group>", "<command>", "--help"] for the fields of a command.';

// 지금 부를 수 있는 앱 command다. 부를 때마다 읽는다(`apps`가 지금 할당, 활성 release 선언, 비공개 규칙으로 정한다).
export type AppCommandLookup = () => Promise<readonly AppCommandEntry[]>;

function lophnHandler(apps?: AppCommandLookup): ToolCallHandler {
  return async (input, ctx) => {
    const { args } = input as { args: string[] };
    const commands = commandsForPlace(ctx.kind);
    // 앱 command는 도움말과 오류에만 쓴다. 실행은 loop가 앞에서 그 command의 호출로 풀었다(`resolveAppCall`).
    const entries =
      apps === undefined || isBuiltinWord(args[0]) ? [] : await apps();
    const docs: readonly CommandDoc[] = [
      ...commands,
      ...entries.map((entry) => entry.doc),
    ];
    const parsed = parseCommandLine(args, docs);
    if (!parsed.ok) return parsed;
    if (parsed.value.kind === "run") {
      return invalid("the call did not resolve to a command");
    }
    const text = helpText(docs, parsed.value.topic);
    return text === undefined
      ? invalid(`unknown command: ${parsed.value.topic.join(" ")}`)
      : ok(fitted("help", { help: text }));
  };
}

// 이 tool이 loop 앞에서 명령 호출로 풀리지 못한 호출만 handler에 온다: 도움말 요청과 틀린 명령줄이다.
// 풀린 호출은 명령의 정의(`command-tool.ts`, `app-tool/command.ts`)로 실행된다.
export const LOPHN_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "lophn",
    input: z.strictObject({ args: z.array(z.string()).min(1) }),
    routes: [],
    description: USAGE,
    effect: "read",
    handler: lophnHandler(),
  }),
];

// 앱 command의 도움말(`lophn <slug> --help`)을 답하는 `lophn` tool이다. 정의의 나머지는 그대로다.
export function withApps(
  tool: ToolDefinition,
  apps: AppCommandLookup,
): ToolDefinition {
  return { ...tool, handler: lophnHandler(apps) };
}

// 설명 끝에 그 place 종류가 부를 수 있는 명령을 이름순으로 싣는다. 같은 place 종류면 늘 같은 bytes다(cache).
export function describeLophn(
  tool: ToolDefinition,
  kind: PlaceKind,
): ToolDefinition {
  const lines = commandsForPlace(kind).map(
    (command) => `${wordsOf(command.name).join(" ")} - ${command.summary}`,
  );
  return {
    ...tool,
    description: `${tool.description}\nCommands:\n${lines.join("\n")}`,
  };
}
