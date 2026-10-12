// SDK command의 route 표와 실행이다. catalog·show·add는 MCP
// `lophn_sdk`과 같은 op·같은 소유 route·같은 흐름(connection/sdk-ops)이다: 같은
// credential·입력의 결과와 거절이 같다.
import {
  cliSdkAddSchema,
  cliSdkCatalogSchema,
  cliSdkShowSchema,
} from "../../../protocol/coding-agent/mod.ts";
import {
  runSdkOp,
  SDK_OP_ROUTES,
  type SdkOp,
  type SdkOpDeps,
  type SdkOpOutput,
} from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

export const SDK_COMMANDS: readonly CommandEntry[] = [
  {
    name: "sdk catalog",
    input: cliSdkCatalogSchema,
    monoRoute: SDK_OP_ROUTES.catalog,
  },
  {
    name: "sdk show",
    input: cliSdkShowSchema,
    monoRoute: SDK_OP_ROUTES.show,
  },
  {
    name: "sdk add",
    input: cliSdkAddSchema,
    monoRoute: SDK_OP_ROUTES.add,
  },
];

export const CLI_SDK_OPS = {
  "sdk catalog": "catalog",
  "sdk show": "show",
  "sdk add": "add",
} as const satisfies Record<string, SdkOp>;

export type CliSdkName = keyof typeof CLI_SDK_OPS;

// 공통 option(출력·연결·daemon·CAS·key·입력 source)은 op 입력이 아니다. add의 반영 앱은 공통
// `--app`이 MCP의 `app` field와 같은 자리다.
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

export function sdkOpInput(
  name: CliSdkName,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const op = CLI_SDK_OPS[name];
  const body: Record<string, unknown> = { op };
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || COMMON_KEYS.has(key)) continue;
    if (key === "app" && op !== "add") continue;
    body[key] = value;
  }
  return body;
}

export async function runSdk(
  name: CliSdkName,
  input: Record<string, unknown>,
  deps: Omit<SdkOpDeps, "surface">,
): Promise<SdkOpOutput> {
  return await runSdkOp(sdkOpInput(name, input), { ...deps, surface: "cli" });
}
