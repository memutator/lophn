// app command의 route 표와 실행이다(T21, cli#R7, R24–R28, R31, R32). 모든 command는 MCP
// `lophn_app`과 같은 op·같은 소유 route·같은 흐름(connection/app-ops)이다: 같은 credential·입력의
// 결과와 거절이 같다(cli#R1). 사람 전용 `app start|stop|release activate`와 `app automation run`은
// route가 없다: coding credential로는 거절이고 결정 화면 링크와 사실만 낸다(cli#R7, R27, R31).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliAppAutomationRunSchema,
  cliAppBlueprintSchema,
  cliAppCommandSchema,
  cliAppInvocationSchema,
  cliAppInvocationsSchema,
  cliAppListSchema,
  cliAppLogsSchema,
  cliAppPathSchema,
  cliAppPreviewStartSchema,
  cliAppPreviewStopSchema,
  cliAppRegisterSchema,
  cliAppReleaseActivateSchema,
  cliAppReleasePrepareSchema,
  cliAppShowSchema,
  cliAppSourceSchema,
  cliAppStartSchema,
  cliAppStatusSchema,
  cliAppStopSchema,
  cliAppSyncToolsSchema,
  cliAppTestSchema,
  cliAppValidateSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  APP_OP_ROUTES,
  type AppHumanOnly,
  type AppOp,
  type AppOpDeps,
  type AppOpOutput,
  humanOnlyReport,
  runAppOp,
} from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

// CLI command 이름 → MCP op다. 이 표 하나로 두 통로의 대응이 정해진다(cli#R1).
export const CLI_APP_OPS = {
  "app list": "list",
  "app show": "show",
  "app path": "show",
  "app register": "register",
  "app source": "source",
  "app validate": "validate",
  "app test": "test",
  "app preview start": "preview_start",
  "app preview stop": "preview_stop",
  "app release prepare": "release_prepare",
  "app status": "status",
  "app blueprint": "blueprint",
  "app invocations": "invocations",
  "app invocation": "invocation",
  "app logs": "logs",
  "app sync-tools": "sync_tools",
  "app command": "command",
} as const satisfies Record<string, AppOp>;

export type CliAppName = keyof typeof CLI_APP_OPS;

function entry(
  name: CliAppName,
  input: CommandEntry["input"],
): CommandEntry {
  // 표가 가리키는 route는 MCP와 같은 소유 route 표 값이다.
  return {
    name,
    input,
    monoRoute: APP_OP_ROUTES[CLI_APP_OPS[name]],
  };
}

// 사람 전용 command는 route가 없다. 표 밖 op와 같은 실행 전 거절이고 안내만 낸다.
function humanOnly(name: AppHumanOnly, input: CommandEntry["input"]) {
  return { name, input } satisfies CommandEntry;
}

export const APP_COMMANDS: readonly CommandEntry[] = [
  entry("app list", cliAppListSchema),
  entry("app show", cliAppShowSchema),
  entry("app path", cliAppPathSchema),
  entry("app register", cliAppRegisterSchema),
  entry("app source", cliAppSourceSchema),
  entry("app validate", cliAppValidateSchema),
  entry("app test", cliAppTestSchema),
  entry("app preview start", cliAppPreviewStartSchema),
  entry("app preview stop", cliAppPreviewStopSchema),
  entry("app release prepare", cliAppReleasePrepareSchema),
  entry("app status", cliAppStatusSchema),
  entry("app blueprint", cliAppBlueprintSchema),
  entry("app invocations", cliAppInvocationsSchema),
  entry("app invocation", cliAppInvocationSchema),
  entry("app logs", cliAppLogsSchema),
  entry("app sync-tools", cliAppSyncToolsSchema),
  entry("app command", cliAppCommandSchema),
  humanOnly("app start", cliAppStartSchema),
  humanOnly("app stop", cliAppStopSchema),
  humanOnly("app release activate", cliAppReleaseActivateSchema),
  humanOnly("app automation run", cliAppAutomationRunSchema),
];

// 검사한 CLI 입력에서 공통 option(출력·연결·daemon·CAS·key·입력 source)을 떼면 MCP op 입력이다.
// 공통 option은 core 요청 입력이 아니다: key는 envelope, input source는 이미 풀린 값이다. 다만
// 소유 입력이 같은 이름의 field를 가지면(preview의 `input`) 그것은 소유 field라 남긴다.
const COMMON_KEYS = new Set([
  "command",
  "json",
  "connection",
  "daemon_url",
  "base_revision",
  "idempotency_key",
  "input",
  "input_file",
]);

export function appOpInput(
  name: CliAppName,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const op = CLI_APP_OPS[name];
  const owned = (APP_OP_ROUTES[op].input as { shape?: Record<string, unknown> })
    .shape ?? {};
  const body: Record<string, unknown> = { op };
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key !== "command" && (!COMMON_KEYS.has(key) || key in owned)) {
      body[key] = value;
    }
  }
  return body;
}

export function isHumanOnly(name: string): name is AppHumanOnly {
  return name === "app start" || name === "app stop" ||
    name === "app release activate" || name === "app automation run";
}

export type AppRunDeps = Omit<AppOpDeps, "surface">;

// command 하나를 실행한다. 결과 모양은 MCP와 같은 {summary, data, next}이고 isError면
// CLI는 성공 exit로 처리하지 않는다(cli#R26).
export async function runApp(
  name: CliAppName | AppHumanOnly,
  input: Record<string, unknown>,
  deps: AppRunDeps,
): Promise<Result<AppOpOutput, LophnError>> {
  if (isHumanOnly(name)) {
    return humanOnlyReport(name, { app: input.app as string | undefined });
  }
  if (!Object.hasOwn(CLI_APP_OPS, name)) {
    return err({ code: "invalid_input", message: `없는 command다: ${name}` });
  }
  const ran = await runAppOp(appOpInput(name, input), {
    ...deps,
    surface: "cli",
  });
  if (name === "app path" && ran.isError === undefined) {
    // path는 앱과 source 위치만 읽는다.
    const app = (ran.data as { app?: Record<string, unknown> }).app ?? {};
    const source = typeof app.source_path === "string" ? app.source_path : null;
    return ok({
      summary: source === null ? "source 미연결" : `source ${source}`,
      data: { app: app.id ?? null, source_path: source },
      next: source === null
        ? ["lophn app source로 구현 시작 source를 연결한다"]
        : ["lophn app status로 개발 상태를 읽는다"],
    });
  }
  return ok(ran);
}
