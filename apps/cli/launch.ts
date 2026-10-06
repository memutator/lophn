// `lophn` launcher가 실행 전에 부르는 권한 계획 entry다(open-issues coding-agent/mcp-server#Q9). 같은
// argv에서 사람이 고른 target·앱을 읽어 이 실행이 더 열 정확한 파일 권한 flag만 한 줄씩 낸다. 읽기·net·helper
// 실행은 CLI와 같고 쓰기·`--allow-run`은 없다. 계산하지 못하면 아무것도 내지 않는다(그 command는 권한이
// 없어 unavailable로 끝난다). 오류 내용도 내지 않는다: 실제 실행(main.ts)이 같은 입력을 다시 읽고 이유를 낸다.
import {
  findCommand,
  parseArgs,
  planSelection,
  selectionFlags,
} from "../../packages/coding-agent/cli/mod.ts";
import {
  discoverDaemonAddress,
  LOPHN_DAEMON_URL,
} from "../../packages/coding-agent/connection/client/daemon.ts";
import {
  connectionFromRef,
  createCoreClient,
} from "../../packages/coding-agent/connection/client/core.ts";
import { createHelperCredentialProvider } from "../../packages/coding-agent/connection/credential/helper.ts";
import type { CredentialProvider } from "../../packages/coding-agent/connection/credential/provider.ts";
import { appGet } from "../../packages/contracts/apps/mod.ts";
import {
  type AgentFailure,
  LOPHN_CONNECTION,
} from "../../packages/contracts/coding-agent/mod.ts";
import type { RpcFetch } from "../../packages/contracts/platform/mod.ts";
import type { Result } from "../../packages/base/mod.ts";
import { ambientEnv } from "./dispatch.ts";
import { candidateOf, commandNameOf, inputOf } from "./invocation.ts";

type Env = { get(name: string): string | undefined };

export type PlanOptions = {
  env?: Env;
  cwd?: string;
  home?: string;
  installRoot?: string;
  provider?: CredentialProvider;
  fetch?: RpcFetch;
};

// 설치 묶음의 위치다. 이 entry는 `<설치 root>/platform/apps/cli/launch.ts`라 세 단계 위다.
const INSTALL_ROOT = new URL("../../../", import.meta.url).pathname;

function readTextOrUndefined(path: string): string | undefined {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return undefined;
  }
}

function value<T>(result: Result<T, AgentFailure>): T | undefined {
  return result.ok ? result.value : undefined;
}

// 이 argv가 더 열 권한 flag들이다. 없으면 빈 배열이다.
export async function planCliPermissions(
  argv: readonly string[],
  options: PlanOptions = {},
): Promise<string[]> {
  const parsed = parseArgs(argv);
  if (parsed.errors.length > 0 || parsed.command === undefined) return [];
  const { command } = commandNameOf(parsed);
  const entry = findCommand(command);
  if (entry === undefined) return [];
  const env = options.env ?? ambientEnv();
  const cwd = options.cwd ?? Deno.cwd();
  const body = inputOf(parsed, cwd);
  if (!body.ok) return [];
  const checked = entry.input.safeParse(
    candidateOf(parsed, command, value(body)),
  );
  if (!checked.success) return [];
  const input = checked.data as Record<string, unknown>;
  const selection = await planSelection({
    command,
    input,
    roots: { home: options.home ?? env.get("HOME") ?? "", env, cwd },
  }, {
    async sourceDirOf(app) {
      const connection = connectionFromRef(
        (typeof input.connection === "string" ? input.connection : undefined) ??
          env.get(LOPHN_CONNECTION),
      );
      if (!connection.ok) return undefined;
      const address = discoverDaemonAddress({
        option: parsed.daemonUrl,
        env: env.get(LOPHN_DAEMON_URL),
        dataRoot: env.get("LOPHN_HOME"),
        readText: readTextOrUndefined,
      });
      if (!address.ok) return undefined;
      const client = createCoreClient({
        baseUrl: address.value.url,
        provider: options.provider ?? createHelperCredentialProvider({
          helper: `${
            (options.installRoot ?? INSTALL_ROOT).replace(/\/$/, "")
          }/lophn-credential`,
        }),
        connection: connection.value,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      const read = await client.read(appGet, { app });
      if (!read.ok) return undefined;
      const source = (read.value as { app?: { source_path?: unknown } }).app
        ?.source_path;
      return typeof source === "string" ? source : undefined;
    },
  });
  return selectionFlags(selection);
}

if (import.meta.main) {
  try {
    const flags = await planCliPermissions(Deno.args);
    if (flags.length > 0) console.log(flags.join("\n"));
  } catch {
    // 계획하지 못하면 아무것도 더하지 않는다.
  }
}
