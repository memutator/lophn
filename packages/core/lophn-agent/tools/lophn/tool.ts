import { z } from "zod";
import { err, ok } from "../../../../base/mod.ts";
import { commandsForWorkspace } from "../../../../cli/commands/mod.ts";
import { helpText } from "../../../../cli/help.ts";
import type { CommandDoc } from "../../../../cli/commands/types.ts";
import {
  parseCommandLine,
  splitOn,
  unknownCommandError,
  wordsOf,
} from "../../../../cli/parser.ts";
import type { WorkspaceKind } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { AppCommands } from "../app-tool/command.ts";
import { defineTool } from "../define.ts";
import { fitted, invalid } from "../fit-result.ts";
import type { ToolCallHandler, ToolDefinition } from "../registry.ts";
import { appScopeOf, isBuiltinWord } from "./resolve.ts";

// 정의의 이름과 같아야 한다. eval의 tool file 표가 `defineTool({ name: "..."` 글자 그대로 읽어서 정의 쪽은 literal이다.
export const LOPHN_TOOL_NAME = "lophn";

const USAGE =
  'Run one lophn command. args is the command line without the leading "lophn", one word per item: ["job", "list"], ["job", "update", "<job id>", "--every", "2h"]. One command per call: no pipes, no &&, no shell.\n' +
  "Fields are flags: --field-name value (the field field_name); repeat a flag for a list; a boolean is --flag or --no-flag; --input '<JSON object>' sets several fields at once and takes JSON values for fields that need one.\n" +
  'Run ["help"] for the groups, ["<group>", "--help"] for the commands of a group and ["<group>", "<command>", "--help"] for the fields of a command.';

// 지금 부를 수 있는 앱 command다. 부를 때마다 읽는다(`apps`가 지금 할당, 활성 release 선언, 비공개 규칙으로 정한다).
export type AppCommandLookup = () => Promise<AppCommands>;

// 다른 기계의 앱을 `lophn help`에 덧붙인다. 읽지 못한 앱은 "not reachable now"다.
function remoteAppsText(apps: AppCommands): string {
  const rows = new Map<string, string[]>();
  for (const entry of apps.entries) {
    if (entry.machine === null) continue;
    const [slug, ...rest] = wordsOf(entry.doc.name);
    const head = `${slug} (on ${entry.machineName ?? entry.machine})`;
    rows.set(head, [...(rows.get(head) ?? []), rest.join(" ")]);
  }
  const lines = [
    ...[...rows].map(([head, names]) => `  ${head}  ${names.join(", ")}`),
    ...apps.unreachable.map(
      (gone) => `  ${gone.name} (on ${gone.machineName}) - not reachable now`,
    ),
  ];
  return lines.length === 0
    ? ""
    : `\n\nApps on other computers (add --on <computer> to the command):\n${lines.join("\n")}`;
}

function lophnHandler(apps?: AppCommandLookup): ToolCallHandler {
  return async (input, ctx) => {
    const { args } = input as { args: string[] };
    const commands = commandsForWorkspace(ctx.kind);
    // `--on`은 다른 기계의 앱 command와, 자기 칸으로 `on`을 받는 내장 명령(call send, session list, agent list, agent card)에만
    // 붙는다. 그 내장 명령은 loop가 앞에서 풀었으므로 여기 온 내장 명령의 `--on`은 틀린 것이다(다른 기계의 터미널·file·job은 범위 밖이다).
    const split = splitOn(args);
    if (!split.ok) return split;
    const { on, argv } = split.value;
    if (on !== null && (argv.length === 0 || isBuiltinWord(argv[0]))) {
      // 그 명령이 `--on`을 받으면 명령줄의 다른 곳이 틀렸다(빠진 칸 같은). 그 오류를 그대로 알린다.
      const parsed = parseCommandLine(args, commands);
      if (
        !parsed.ok &&
        !parsed.error.message.startsWith("unknown flag: --on")
      ) {
        return parsed;
      }
      return invalid(
        "--on goes with an app command, or with call send, session list, agent list or agent card",
      );
    }
    // 앱 목록은 앱 command와 맨 위 도움말에만 읽는다: 다른 컴퓨터를 읽을 수 있어서 내장 명령(`job list`, 그룹 도움말)은 읽지 않는다.
    const wantsApps =
      apps !== undefined &&
      (argv.length === 0 || argv[0] === "help" || !isBuiltinWord(argv[0]));
    const found = wantsApps ? await apps() : undefined;
    const scope = appScopeOf(args, found?.machines ?? []);
    if (!scope.ok) return scope;
    const { machine } = scope.value;
    // 앱 command는 도움말과 오류에만 쓴다. 실행은 loop가 앞에서 그 command의 호출로 풀었다(`resolveAppCall`).
    const entries =
      found === undefined || isBuiltinWord(argv[0])
        ? []
        : found.entries.filter((entry) => entry.machine === machine);
    const docs: readonly CommandDoc[] = [
      ...(machine === null ? commands : []),
      ...entries.map((entry) => entry.doc),
    ];
    const parsed = parseCommandLine(argv, docs);
    if (!parsed.ok) return parsed;
    if (parsed.value.kind === "run") {
      return invalid("the call did not resolve to a command");
    }
    // `--on`은 앱 command에만 듣는다. 내장 명령은 `commands`의 것이다.
    const text = helpText(
      docs,
      parsed.value.topic,
      (item) => !(commands as readonly CommandDoc[]).includes(item),
    );
    if (text === undefined) {
      return err(unknownCommandError(parsed.value.topic, docs));
    }
    const top = machine === null && parsed.value.topic.length === 0;
    return ok(
      fitted("help", {
        help: top && found !== undefined ? text + remoteAppsText(found) : text,
      }),
    );
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

// 설명 끝에 그 workspace 종류가 부를 수 있는 명령을 이름순으로 싣는다. 같은 workspace 종류면 늘 같은 bytes다(cache).
export function describeLophn(
  tool: ToolDefinition,
  kind: WorkspaceKind,
): ToolDefinition {
  const lines = commandsForWorkspace(kind).map(
    (command) => `${wordsOf(command.name).join(" ")} - ${command.summary}`,
  );
  return {
    ...tool,
    description: `${tool.description}\nCommands:\n${lines.join("\n")}`,
  };
}
