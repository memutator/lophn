import { ok } from "../../../../base/mod.ts";
import {
  appCallTool,
  type ToolCallOutput,
} from "../../../../protocol/apps/mod.ts";
import type { AppCommand } from "../../../../protocol/apps/declaration/read.ts";
import type { AssignmentEntry } from "../../../../protocol/approvals/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import type { CommandDoc } from "../../../../cli/commands/types.ts";
import { appCommandDoc } from "../../../../cli/commands/app-command.ts";
import { commandLine } from "../../../../cli/parser.ts";
import { readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { SpillableResult } from "../spill.ts";
import type { ToolContext } from "../tool-context.ts";

// 앱 command를 `lophn <domain> <command>`로 부르는 길이다. 어느 command가 지금 불리는지는 부를 때 정한다: 지금 할당(앱, 뺀 command),
// 활성 release의 선언, domain 규칙(맡은 domain이면 전부, 아니면 public만). 묻기는 run-loop tool gate가, 막기는 core 호출 경로가 하고
// invocation 기록, 결과 모름도 core가 다룬다. 정의는 loop가 기록·Gate·retry에 쓰는 것이고 model에는 보이지 않는다.

export const APP_TOOL_CONTRACT = appCallTool.name;

// 활성 release에서 읽은 command 선언이다.
export type AppToolView = {
  app: string;
  name: string;
  release: string;
  tools: readonly AppCommand[];
};

export type AppCommandEntry = {
  app: string;
  appName: string;
  command: AppCommand;
  // parser와 help가 읽는다. 이름은 `<domain>.<command>`이고 기록 이름도 이것이다.
  doc: CommandDoc;
};

// 할당이 이 command를 부르게 두는가. 앱을 할당하지 않았거나 command를 뺐으면 아니다.
function assigned(
  entries: readonly AssignmentEntry[],
  app: string,
  command: string,
): boolean {
  const entry = entries.find((one) => one.app === app);
  return entry !== undefined && !entry.removed_tools.includes(command);
}

// 앱 ∩ 선언 ∩ 할당. 순서는 앱, command 이름 순이다. domain 규칙은 views를 거른 쪽(`withPublicOnly`)이 한다.
export function appCommandEntries(source: {
  views: readonly AppToolView[];
  entries: readonly AssignmentEntry[];
}): AppCommandEntry[] {
  const out: AppCommandEntry[] = [];
  const views = [...source.views].sort((a, b) => (a.app < b.app ? -1 : 1));
  for (const view of views) {
    const declared = [...view.tools].sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const command of declared) {
      if (!assigned(source.entries, view.app, command.name)) continue;
      out.push({
        app: view.app,
        appName: view.name,
        command,
        doc: appCommandDoc(command),
      });
    }
  }
  return out;
}

function callerOf(ctx: ToolContext) {
  return {
    kind: "agent",
    session: ctx.session,
    turn: ctx.turn,
    tool_call: ctx.tool_call,
  } as const;
}

function toolResult(
  status: ToolResult["status"],
  summary: string,
  content: unknown,
  extra: Partial<Pick<ToolResult, "complete" | "pending">> = {},
): SpillableResult {
  return {
    status,
    summary,
    content: content as ToolResult["content"],
    complete: true,
    source: null,
    continuation: null,
    pending: [],
    // 크기 상한은 runtime이 맞춘다(spill.ts). 앱 결과는 여기서 줄이지 않는다.
    spill: { arrayKeys: [] },
    ...extra,
  };
}

export function appCommandTool(entry: AppCommandEntry): ToolDefinition {
  const { app, appName, command, doc } = entry;
  return {
    name: doc.name,
    description: command.description,
    input: doc.input,
    effect: command.effect,
    origin: "app",
    operations: [APP_TOOL_CONTRACT],
    display: (input) => ({
      category: "command",
      title: commandLine(doc, input as Record<string, unknown>),
    }),
    handler: async (input, ctx) => {
      const reply = await readOf(ctx.core, appCallTool, {
        target: { mode: "live", app, release: null },
        kind: "command",
        name: command.name,
        ...(command.inputSchema === null ? {} : { input }),
        caller: callerOf(ctx),
      });
      if (!reply.ok) return reply;
      return ok(resultOf(appName, command, reply.value));
    },
    // 묻기는 run-loop tool gate, 막기는 core 호출 경로.
    gate: () => ({
      kind: "app_tool",
      app,
      tool: command.name,
      effect: command.effect,
    }),
  };
}

// core가 돌려준 상태(성공, 실패, 거절, 결과 모름)를 그대로 옮긴다. 앱 결과는 감싸지 않는다.
function resultOf(
  appName: string,
  command: AppCommand,
  output: ToolCallOutput,
): SpillableResult {
  const label = `command ${command.name} of ${appName}`;
  const { invocation, outcome } = output;
  switch (outcome.status) {
    case "succeeded":
      return toolResult("success", `${label} finished`, {
        invocation,
        result: outcome.result,
      });
    case "failed":
      return toolResult("failure", `${label} failed`, {
        invocation,
        error: outcome.error,
      });
    case "denied":
      return toolResult("not_executed", `${label} was not run`, {
        invocation,
        denied: outcome.denial,
      });
    case "unknown":
      return toolResult(
        "uncertain",
        `the result of ${label} is not known`,
        { invocation, reason: outcome.reason },
        {
          pending: [
            command.effect === "read"
              ? "the read can be repeated"
              : "check the app before repeating this call",
          ],
        },
      );
  }
}
