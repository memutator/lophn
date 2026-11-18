// 앱이 내놓은 바깥 command를 `lophn <slug> <command>`로 부르는 입구의 binary(사람) 쪽이다. command는 앱의 활성 release 선언에
// 있어 표(`mod.ts`)에 정적으로 없다. binary가 앱 slug로 앱을 찾아 선언을 읽고, 지금 `agent run`처럼 run(`runs.start kind:tool`)으로
// 불러 결과를 기다린다. 사람은 그 앱의 command를 비공개까지 모두 부른다. `--on <기계>`이면 core가 `remoteCore`라 slug와 선언은
// 그 기계의 것이고, 부르기는 run이 아니라 `apps/remote_call` 하나다(run은 이 기계의 앱을 이 기계에서 부를 때의 기록이다). lophn agent는 같은 `appCommandDoc`으로 명령줄을 읽되
// 부를 때 할당·비공개 규칙으로 거른 목록을 core가 쓴다(`core/lophn-agent/tools/app-tool`).
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import { appTools } from "../../protocol/apps/declaration/read.ts";
import type { AppCommand } from "../../protocol/apps/declaration/read.ts";
import {
  appList,
  appRemoteCall,
  type ToolCallOutput,
  type InputSchema,
  validateInput,
} from "../../protocol/apps/mod.ts";
import { runStart, runWait } from "../../protocol/runs/mod.ts";
import { start } from "./run.ts";
import {
  type Command,
  type CommandContext,
  type CommandCore,
  type CommandDoc,
  type CommandResult,
  defineCommand,
} from "./types.ts";

const NO_INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

// 선언의 inputSchema는 null(인자 없음)이거나 root가 object라 그대로 입력이 된다. 선언의 schema를 meta로 달아 parser가 flag를
// 이 schema에서 만든다. 값을 바꾸지 않고 틀리면 issue를 낸다.
export function appCommandInput(schema: InputSchema | null): z.ZodType {
  const validator = z.unknown().superRefine((value, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return fail("input must be an object");
    if (schema === null) {
      if (Object.keys(value).length > 0) fail("this command takes no input");
      return;
    }
    const checked = validateInput(schema, value);
    if (!checked.ok) fail(checked.error.message);
  });
  return validator.meta(schema === null ? { ...NO_INPUT } : { ...schema });
}

// 이름은 `<slug>.<command>`다. 기록 이름도 이것이다.
export function appCommandDoc(slug: string, command: AppCommand): CommandDoc {
  return {
    name: `${slug}.${command.name}`,
    summary: command.description.split("\n")[0],
    description: command.description,
    input: appCommandInput(command.inputSchema as InputSchema | null),
    effect: command.effect,
  };
}

// 실패·막힘·결과 모름은 지금 run이 실패한 것처럼 `failed`로 알려 exit 4가 된다.
function remoteResult(output: ToolCallOutput): CommandResult {
  const { outcome } = output;
  const content = output as unknown as Record<string, unknown>;
  if (outcome.status === "succeeded") {
    return {
      summary: "command done",
      content,
      text:
        typeof outcome.result === "string"
          ? outcome.result
          : JSON.stringify(outcome.result),
    };
  }
  const failed =
    outcome.status === "failed"
      ? `failed: ${outcome.error.code}: ${outcome.error.message}`
      : outcome.status === "denied"
        ? `denied: ${outcome.denial.code}: ${outcome.denial.message}`
        : `result unknown: ${outcome.reason}`;
  return { summary: `command ${outcome.status}`, content, failed };
}

function appCommand(
  app: string,
  slug: string,
  command: AppCommand,
  remote: boolean,
): Command {
  const input = (given: Record<string, unknown>) =>
    command.inputSchema === null ? {} : { input: given };
  const callRemote = async (
    given: Record<string, unknown>,
    ctx: CommandContext,
  ): Promise<Result<CommandResult, LophnError>> => {
    // 입력은 받는 기계가 검사한다(선언이 그 기계의 판일 수 있다).
    const called = await ctx.core.read(appRemoteCall, {
      app,
      command: command.name,
      ...input(given),
    });
    return called.ok ? ok(remoteResult(called.value)) : called;
  };
  return defineCommand({
    ...appCommandDoc(slug, command),
    routes: remote ? [appRemoteCall] : [runStart, runWait],
    workspaces: [],
    run: (given: Record<string, unknown>, ctx) =>
      remote
        ? callRemote(given, ctx)
        : start(
            ctx,
            { kind: "tool", app, tool: command.name, ...input(given) },
            true,
          ),
  });
}

const MAX_PAGES = 20;

// 앱 slug의 앱 command 전부다. 없는 slug면 빈 목록이다. remote는 core가 다른 기계로 가는 `remoteCore`일 때다.
export async function loadAppCommands(
  core: CommandCore,
  slug: string,
  remote = false,
): Promise<Result<readonly Command[]>> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listed = await core.read(appList, {
      status: "active",
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    const found = listed.value.apps.find((item) => item.slug === slug);
    if (found !== undefined) {
      const declaration = await core.read(appTools, { app: found.id });
      if (!declaration.ok) {
        return declaration.error.code === "not_found" ? ok([]) : declaration;
      }
      return ok(
        declaration.value.tools.map((command) =>
          appCommand(found.id, slug, command, remote),
        ),
      );
    }
    if (listed.value.next_cursor === null) return ok([]);
    cursor = listed.value.next_cursor;
  }
  return err({ code: "unavailable", message: "the app list is too long" });
}
