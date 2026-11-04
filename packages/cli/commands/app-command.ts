// 앱이 내놓은 바깥 command를 `lophn <slug> <command>`로 부르는 입구의 binary(사람) 쪽이다. command는 앱의 활성 release 선언에
// 있어 표(`mod.ts`)에 정적으로 없다. binary가 앱 slug로 앱을 찾아 선언을 읽고, 지금 `agent run`처럼 run(`runs.start kind:tool`)으로
// 불러 결과를 기다린다. 사람은 그 앱의 command를 비공개까지 모두 부른다. lophn agent는 같은 `appCommandDoc`으로 명령줄을 읽되
// 부를 때 할당·비공개 규칙으로 거른 목록을 core가 쓴다(`core/lophn-agent/tools/app-tool`).
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { appTools } from "../../protocol/apps/declaration/read.ts";
import type { AppCommand } from "../../protocol/apps/declaration/read.ts";
import {
  appList,
  type InputSchema,
  validateInput,
} from "../../protocol/apps/mod.ts";
import { runStart, runWait } from "../../protocol/runs/mod.ts";
import { start } from "./run.ts";
import {
  type Command,
  type CommandCore,
  type CommandDoc,
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

function appCommand(app: string, slug: string, command: AppCommand): Command {
  return defineCommand({
    ...appCommandDoc(slug, command),
    routes: [runStart, runWait],
    places: [],
    run: (input, ctx) =>
      start(
        ctx,
        {
          kind: "tool",
          app,
          tool: command.name,
          ...(command.inputSchema === null ? {} : { input }),
        },
        true,
      ),
  });
}

const MAX_PAGES = 20;

// 앱 slug의 앱 command 전부다. 없는 slug면 빈 목록이다.
export async function loadAppCommands(
  core: CommandCore,
  slug: string,
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
          appCommand(found.id, slug, command),
        ),
      );
    }
    if (listed.value.next_cursor === null) return ok([]);
    cursor = listed.value.next_cursor;
  }
  return err({ code: "unavailable", message: "the app list is too long" });
}
