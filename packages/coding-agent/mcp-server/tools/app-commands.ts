// blueprint 유래 앱 read command tool이다(T23, mcp#R34·R35). app toolset을 켠 연결의 scope 안
// 앱에서 active release blueprint의 `effect=read`·`confirm=false` command마다 tool 하나를 낸다.
// 호출은 `lophn_app command`와 같은 한 흐름(`runAppOp`)이라 preview 기본값·앱 통로 direct call·
// 결과 불명 구별이 같고 읽기가 core ledger 쓰기를 기다리지 않는다. 정의는 호출마다 현재
// blueprint로 다시 만들고, 목록에 낸 정의와 달라졌으면 옛 정의로 부르지 않고 conflict로 돌려준다.
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import { appBlueprint, appList } from "../../../contracts/apps/mod.ts";
import type {
  CommandDeclaration,
  InputSchema,
} from "../../../contracts/apps/mod.ts";
import {
  APP_TOOL_NAME_PREFIX,
  appCommandToolInputSchema,
  appToolName,
} from "../../../contracts/coding-agent/mod.ts";
import {
  type AppOpDeps,
  runAppOp,
  UNREADABLE_MESSAGE,
} from "../../connection/mod.ts";
import type { ToolEntry } from "../registry.ts";
import type { ToolOutput } from "./output.ts";

// active release의 blueprint에서 command 정의만 읽은 값이다. 소유 route(apps#T19
// `/v1/apps/blueprint`)가 낸 것을 이 모양으로 옮기는 어댑터가 source를 만든다. 범위 밖·없는 앱과
// active release가 없는 앱은 null이다(같은 답).
export type AppBlueprintView = {
  release: string;
  blueprint_hash: string;
  commands: readonly Pick<
    CommandDeclaration,
    "key" | "label" | "description" | "effect" | "confirm" | "input"
  >[];
};
export type AppBlueprintSource = (
  app: string,
) => Promise<Result<AppBlueprintView | null, LophnError>>;

// 소유 read(`/v1/apps/blueprint`, apps#T19)로 source를 만든다. 범위 밖·없는 앱·active release가
// 없는 앱은 같은 not_found라 null이다(같은 답). 그 밖의 실패는 호출 쪽이 앱이 없는 것과 같이 다룬다.
export function appBlueprintSourceOf(
  client: Pick<AppOpDeps["client"], "read">,
): AppBlueprintSource {
  return async (app) => {
    const read = await client.read(appBlueprint, { app });
    if (!read.ok) {
      return read.error.code === "not_found" ? ok(null) : read;
    }
    const value = read.value as {
      release: string;
      blueprint_hash: string;
      commands: AppBlueprintView["commands"];
    };
    return ok({
      release: value.release,
      blueprint_hash: value.blueprint_hash,
      commands: value.commands,
    });
  };
}

export type AppCommandToolsDeps = Omit<AppOpDeps, "surface" | "progress"> & {
  blueprint: AppBlueprintSource;
  // 정의가 바뀐 것을 알았을 때 `notifications/tools/list_changed`를 보낸다.
  listChanged?: () => void | Promise<void>;
};

type Definition = {
  entry: ToolEntry;
  app: string;
  command: string;
  // release·blueprint·정의 전체가 같아야 같은 정의다.
  stamp: string;
};

export type AppCommandTools = ReturnType<typeof createAppCommandTools>;

const ENVIRONMENT_SCHEMA = {
  type: "string",
  enum: ["preview", "live"],
  description: "기본 preview. live는 운영 앱",
};

function entryFor(
  appName: string,
  command: AppBlueprintView["commands"][number],
  name: string,
): ToolEntry {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  // 원 input schema를 그대로 둔다. command가 입력을 받지 않으면 input 자리가 없다.
  if (command.input !== null) {
    properties.input = command.input satisfies InputSchema;
    if ((command.input.required ?? []).length > 0) required.push("input");
  }
  properties.environment = ENVIRONMENT_SCHEMA;
  properties.timeout_ms = { type: "integer", minimum: 1 };
  return {
    name,
    description:
      `앱 ${appName}의 command ${command.key}(읽기). ${command.description}`,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length === 0 ? {} : { required }),
    },
    readOnlyHint: true,
  };
}

type ListedApp = { id: string; name: string; active_release: string | null };

export function createAppCommandTools(deps: AppCommandToolsDeps) {
  // 마지막 목록에 낸 정의의 stamp다. 호출은 이것과 지금 정의를 견준다.
  const advertised = new Map<string, string>();

  // 지금 scope 안 앱의 지금 정의다. scope 판정은 core의 앱 목록이고, 앱 읽기 실패는 그 앱이
  // 없는 것과 같다. 한 이름에 다른 command가 겹치면 덮지 않고 discovery 실패다.
  async function discover(): Promise<
    Result<Map<string, Definition>, LophnError>
  > {
    const apps: ListedApp[] = [];
    let cursor: string | undefined;
    do {
      const page = await deps.client.read(
        appList,
        cursor === undefined
          ? { status: "active" }
          : { status: "active", cursor },
      );
      // 목록을 읽지 못하면 동적 tool이 없다. 고정 tool은 그대로 나간다.
      if (!page.ok) return ok(new Map());
      const value = page.value as {
        apps?: ListedApp[];
        next_cursor?: string | null;
      };
      apps.push(...(value.apps ?? []));
      cursor = typeof value.next_cursor === "string" && value.next_cursor !== ""
        ? value.next_cursor
        : undefined;
    } while (cursor !== undefined);
    const found = new Map<string, Definition>();
    const views = await Promise.all(
      apps.filter((app) => app.active_release !== null).map(async (app) => ({
        app,
        view: await deps.blueprint(app.id),
      })),
    );
    for (const { app, view } of views) {
      if (!view.ok || view.value === null) continue;
      const appHash = await sha256Hex(app.id);
      for (const command of view.value.commands) {
        if (command.effect !== "read" || command.confirm) continue;
        const name = appToolName(appHash, await sha256Hex(command.key));
        if (found.has(name)) {
          return err({
            code: "conflict",
            message: "blueprint 유래 tool 이름이 서로 다른 command와 겹친다",
            details: { name },
          });
        }
        const entry = entryFor(app.name, command, name);
        found.set(name, {
          entry,
          app: app.id,
          command: command.key,
          stamp: JSON.stringify([
            app.id,
            view.value.release,
            view.value.blueprint_hash,
            entry,
          ]),
        });
      }
    }
    return ok(found);
  }

  // 정의가 바뀌었다. 옛 정의로 부르지 않고 목록 재조회를 알린다. list_changed를 받지 않는
  // client(Codex)를 위해 같은 호출을 고정 op로 하는 방법도 준다(R35).
  async function stale(
    name: string,
    current: Definition | undefined,
  ): Promise<ToolOutput> {
    try {
      await deps.listChanged?.();
    } catch {
      // 알림 실패는 거절을 바꾸지 않는다.
    }
    const fixed = current === undefined
      ? "lophn_app command {app, command, input}"
      : `lophn_app command {"app":"${current.app}","command":"${current.command}","input":…}`;
    return failed(
      "conflict",
      "앱 command 정의가 바뀌었다. 옛 정의로 부르지 않는다. 목록을 다시 읽는다",
      { tool: name, relist: true },
      [
        "tools/list를 다시 읽는다(list_changed를 보냈다)",
        `list_changed를 받지 않는 client는 고정 op로 부른다: ${fixed}`,
      ],
    );
  }

  return {
    owns(name: string): boolean {
      return name.startsWith(APP_TOOL_NAME_PREFIX);
    },

    async list(): Promise<Result<ToolEntry[], LophnError>> {
      const found = await discover();
      if (!found.ok) return found;
      advertised.clear();
      for (const [name, definition] of found.value) {
        advertised.set(name, definition.stamp);
      }
      return ok([...found.value.values()].map((item) => item.entry));
    },

    async call(
      name: string,
      rawInput: unknown,
      context?: { progress?: (message: string) => void | Promise<void> },
    ): Promise<ToolOutput> {
      const outer = appCommandToolInputSchema.safeParse(rawInput ?? {});
      if (!outer.success) {
        return failed("invalid_input", "tool 입력이 맞지 않다", { tool: name });
      }
      const found = await discover();
      if (!found.ok) {
        return failed(found.error.code, found.error.message, {
          ...(found.error.details ?? {}),
        });
      }
      const current = found.value.get(name);
      const shown = advertised.get(name);
      // 목록에 낸 적 없고 지금도 없으면 없는 이름이다. write·external·confirm command와
      // 범위 밖 앱도 여기다: 이름이 없는 것과 같은 답이다.
      if (current === undefined && shown === undefined) {
        return failed("not_found", UNREADABLE_MESSAGE, {});
      }
      if (
        current === undefined ||
        (shown !== undefined && shown !== current.stamp)
      ) {
        return await stale(name, current);
      }
      const { input, environment, timeout_ms } = outer.data;
      return await runAppOp({
        op: "command",
        app: current.app,
        command: current.command,
        ...(input === undefined ? {} : { input }),
        ...(environment === undefined ? {} : { environment }),
        ...(timeout_ms === undefined ? {} : { timeout_ms }),
      }, { ...deps, surface: "mcp", progress: context?.progress });
    },
  };
}

function failed(
  code: LophnError["code"],
  message: string,
  details: Record<string, unknown>,
  next: string[] = [],
): ToolOutput {
  return {
    summary: message,
    data: { code, details },
    next,
    isError: true,
  };
}
