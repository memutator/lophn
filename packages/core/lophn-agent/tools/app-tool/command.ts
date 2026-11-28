import { ok } from "../../../../base/mod.ts";
import {
  appCallTool,
  type ToolCallOutput,
} from "../../../../protocol/apps/mod.ts";
import type { AppCommand } from "../../../../protocol/apps/declaration/read.ts";
import type { AssignmentEntry } from "../../../../protocol/approvals/mod.ts";
import { missingSecretSentence } from "../../../../protocol/lophn-agent/input-request.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import type { CommandDoc } from "../../../../cli/commands/types.ts";
import { appCommandDoc } from "../../../../cli/commands/app-command.ts";
import { commandLine } from "../../../../cli/parser.ts";
import { toWireToolName } from "../../../../protocol/lophn-agent/tool-catalog.ts";
import type { MachineCandidate } from "../../../../protocol/machine/requester.ts";
import { readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { SpillableResult } from "../spill.ts";
import type { ToolContext } from "../tool-context.ts";

// 앱 command를 `lophn <slug> <command>`로 부르는 길이다. 어느 command가 지금 불리는지는 부를 때 정한다: 지금 배포(이 컴퓨터의 앱)나 할당(다른 컴퓨터의 앱),
// 활성 release의 선언, 비공개 규칙(그 앱 workspace의 session이면 전부, 아니면 public만). 묻기는 run-loop tool gate가, 막기는 core 호출 경로가 하고
// invocation 기록, 결과 모름도 core가 다룬다. 정의는 loop가 기록·Gate·retry에 쓰는 것이고 model에는 보이지 않는다.

export const APP_TOOL_CONTRACT = appCallTool.name;

// 활성 release에서 읽은 command 선언이다. `machine`이 있으면 그 기계의 앱이다(앱 id는 기계 사이에 같다).
export type AppToolView = {
  app: string;
  machine?: string;
  slug: string;
  name: string;
  release: string;
  tools: readonly AppCommand[];
};

export type AppCommandEntry = {
  app: string;
  appName: string;
  // 다른 기계의 앱이면 그 기계(`mch_`)와 이름이다. 이 기계의 앱이면 null이다.
  machine: string | null;
  machineName: string | null;
  command: AppCommand;
  // parser와 help가 읽는다. 이름은 `<slug>.<command>`이고 기록 이름도 이것이다.
  doc: CommandDoc;
};

// 다른 컴퓨터 앱의 할당이 이 command를 부르게 두는가. 앱을 할당하지 않았거나 command를 뺐으면 아니다. 줄은 `(machine, app)`이다.
// 이 컴퓨터의 앱은 할당이 없다: 목록에 든 앱의 command는 모두 풀리고 부를 때 Gate가 배포를 본다.
function remoteAssigned(
  entries: readonly AssignmentEntry[],
  machine: string,
  app: string,
  command: string,
): boolean {
  const entry = entries.find(
    (one) => one.app === app && one.machine === machine,
  );
  return entry !== undefined && !entry.removed_tools.includes(command);
}

// 다른 기계의 command는 설명 앞에 그 컴퓨터를 적는다: 그 글은 그 컴퓨터가 낸 것이고 command도 거기서 돈다.
function docOf(
  view: AppToolView,
  command: AppCommand,
  machines: readonly MachineCandidate[] | undefined,
): CommandDoc {
  const doc = appCommandDoc(view.slug, command);
  if (view.machine === undefined) return doc;
  const where =
    machines?.find((one) => one.machine === view.machine)?.name ?? view.machine;
  return {
    ...doc,
    summary: `(runs on ${where}) ${doc.summary}`,
    description: `This command runs on the computer ${where}; its description below was written there.\n\n${command.description}`,
  };
}

// 앱 ∩ 선언(∩ 다른 컴퓨터 앱 할당). 순서는 이 기계의 앱, 다른 기계의 앱 다음 앱, command 이름 순이다. 비공개 규칙은 views를 거른 쪽(`withPublicOnly`)이 한다.
export function appCommandEntries(source: {
  views: readonly AppToolView[];
  entries: readonly AssignmentEntry[];
  machines?: readonly MachineCandidate[];
}): AppCommandEntry[] {
  const out: AppCommandEntry[] = [];
  const key = (view: AppToolView) => `${view.machine ?? ""}/${view.app}`;
  const views = [...source.views].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  for (const view of views) {
    const declared = [...view.tools].sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const command of declared) {
      if (
        view.machine !== undefined &&
        !remoteAssigned(source.entries, view.machine, view.app, command.name)
      ) {
        continue;
      }
      out.push({
        app: view.app,
        appName: view.name,
        machine: view.machine ?? null,
        machineName:
          view.machine === undefined
            ? null
            : (source.machines?.find((one) => one.machine === view.machine)
                ?.name ?? null),
        command,
        doc: docOf(view, command, source.machines),
      });
    }
  }
  return out;
}

// 지금 부를 수 있는 앱 command와 `--on`이 기계를 고르는 명단, 할당했지만 지금 읽지 못한 다른 기계의 앱(꺼진 기계, 거절)이다.
export type AppCommands = {
  entries: readonly AppCommandEntry[];
  machines: readonly MachineCandidate[];
  unreachable: readonly {
    machine: string;
    machineName: string;
    name: string;
  }[];
};

export const NO_APP_COMMANDS: AppCommands = {
  entries: [],
  machines: [],
  unreachable: [],
};

export function appCommands(source: {
  views: readonly AppToolView[];
  entries: readonly AssignmentEntry[];
  machines: readonly MachineCandidate[];
}): AppCommands {
  return {
    entries: appCommandEntries(source),
    machines: source.machines,
    unreachable: source.entries.flatMap((entry) =>
      source.views.some(
        (view) => view.machine === entry.machine && view.app === entry.app,
      )
        ? []
        : [
            {
              machine: entry.machine,
              machineName:
                source.machines.find((one) => one.machine === entry.machine)
                  ?.name ?? entry.machine,
              name: entry.name,
            },
          ],
    ),
  };
}

// loop가 기록·Gate·retry에 쓰는 tool 이름. 다른 기계의 앱 command는 같은 wire 이름이 이 기계에도 다른 기계에도 있을 수 있어 기계 id의 끝을 붙인다
// (한 turn에서 둘을 함께 부르면 정의가 섞이지 않는다).
export function appToolName(entry: AppCommandEntry): string {
  return entry.machine === null
    ? entry.doc.name
    : `${entry.doc.name}.on_${entry.machine.slice(-8)}`;
}

export function appToolWireName(entry: AppCommandEntry): string {
  return toWireToolName(appToolName(entry));
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
  const { app, appName, command, doc, machine, machineName } = entry;
  return {
    name: appToolName(entry),
    description: doc.description,
    input: doc.input,
    effect: command.effect,
    origin: "app",
    operations: [APP_TOOL_CONTRACT],
    display: (input) => ({
      category: "command",
      title: `${commandLine(doc, input as Record<string, unknown>)}${
        machineName === null ? "" : ` --on ${machineName}`
      }`,
    }),
    handler: async (input, ctx) => {
      const reply = await readOf(ctx.core, appCallTool, {
        target:
          machine === null
            ? { mode: "live", app, release: null }
            : { mode: "remote", machine, app },
        kind: "command",
        name: command.name,
        ...(command.inputSchema === null ? {} : { input }),
        caller: callerOf(ctx),
      });
      if (!reply.ok) return reply;
      return ok(resultOf(appName, command, reply.value, machineName));
    },
    // 묻기는 run-loop tool gate(배포되지 않은 앱을 묻는다), 막기는 core 호출 경로. 다른 기계의 앱은 묻는 판정이 없고(할당이 허락이다) 막기는 core가 넘기기 전에 한다.
    ...(machine === null
      ? {
          gate: () => ({
            kind: "app_tool" as const,
            app,
            tool: command.name,
            effect: command.effect,
          }),
        }
      : {}),
  };
}

// core가 돌려준 상태(성공, 실패, 거절, 결과 모름)를 그대로 옮긴다. 앱 결과는 감싸지 않는다.
function resultOf(
  appName: string,
  command: AppCommand,
  output: ToolCallOutput,
  machineName: string | null,
): SpillableResult {
  const label =
    machineName === null
      ? `command ${command.name} of ${appName}`
      : `command ${command.name} of ${appName} on ${machineName}`;
  const { invocation, outcome } = output;
  switch (outcome.status) {
    case "succeeded":
      return toolResult("success", `${label} finished`, {
        invocation,
        result: outcome.result,
      });
    case "failed": {
      // core가 이 호출이 쓰려던 secret의 값이나 sign-in이 비어 있음을 보았으면 그 자리와 청하는 명령을 싣는다.
      // 앱이 쓴 오류 글과 따로 lophn이 쓴 문장이다.
      // 다른 컴퓨터의 비어 있는 secret은 그 컴퓨터의 일이다: 그 컴퓨터가 고른 이름으로 이 컴퓨터의 사람에게 secret을 청하지 않는다.
      if (machineName !== null) {
        return toolResult(
          "failure",
          (outcome.missing ?? []).length === 0
            ? `${label} failed`
            : `${label} failed: the app on ${machineName} is missing something it needs. It has to be set up on that computer`,
          { invocation, error: outcome.error },
        );
      }
      const missing = outcome.missing ?? [];
      return toolResult(
        "failure",
        missing.length === 0
          ? `${label} failed`
          : `${label} failed. ${missing.map(missingSecretSentence).join(" ")}`,
        {
          invocation,
          error: outcome.error,
          ...(missing.length === 0 ? {} : { missing }),
        },
      );
    }
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
