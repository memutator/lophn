// binary가 core에 붙는 한 길이다. agent turn 자격이 있으면 그 자격으로만 부르고,
// 없으면 공용 ensure로 core를 띄우거나 붙어 user 자격을 받는다.
import {
  err,
  ok,
  type OsPlatform,
  type Result,
  systemClock,
} from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import {
  type ControlDial,
  controlConnect,
  controlIdentify,
  controlStop,
  type EnsureTimer,
  ensureCore,
  type RpcFetch,
  type SpawnDetached,
} from "../../protocol/client/mod.ts";
import type { CommandCore } from "../commands/types.ts";
import { clientCore } from "./command-core.ts";
import { createCoreClient } from "./client/core.ts";
import {
  type DaemonAddress,
  explicitDaemonAddress,
  LOPHN_DAEMON_URL,
  sameCoreAddress,
} from "./client/daemon.ts";
import { cliDial, spawnDetachedCore } from "./client/node.ts";
import {
  agentCredential,
  inAgentShell,
  type ReadCredentialFile,
} from "./client/token.ts";

export type CliConnection = {
  core: CommandCore;
  // 출력에서 지울 자격이다. agent turn 자격이면 그것이고, 아니면 ensure가 받은 user token이다.
  token: string;
};

type CliIo = {
  env: { get(name: string): string | undefined };
  // 없으면 core socket 경로도, detached 시작도 할 수 없다.
  dataRoot: string | undefined;
  platform: OsPlatform;
  // 설치본의 platform/ 또는 개발 checkout의 root다. core entry와 Electron 자리가 여기서 나온다.
  platformRoot: string;
  // root package.json의 판. identify가 알린 판과 다르면 ensure가 core를 한 번 갈아 띄운다.
  productVersion: string;
  fetch?: RpcFetch;
  // 시험·다른 입구가 끼우는 IO. 없으면 node adapter를 쓴다.
  dial?: ControlDial;
  spawnDetached?: SpawnDetached;
  readCredential?: ReadCredentialFile;
};

const TIMER: EnsureTimer = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

// 붙기만 하는 길이 기동 중인 core를 기다리는 한도. ensure의 ready 기다림과 같다.
const STARTING_MS = 60_000;

type Io = { dial: ControlDial; spawnDetached: SpawnDetached };

// control socket 경로는 data root와 OS에서 나온다. 데이터 root를 모르면 core를 찾을 수도 띄울 수도 없다.
function dataRootOf(request: {
  dataRoot: string | undefined;
}): Result<string, LophnError> {
  const dataRoot = request.dataRoot;
  return dataRoot === undefined || dataRoot === ""
    ? err({ code: "unavailable", message: "lophn data root를 찾지 못했다" })
    : ok(dataRoot);
}

function dialOf(request: {
  env: { get(name: string): string | undefined };
  dataRoot: string;
  platform: OsPlatform;
  dial?: ControlDial;
}): Result<ControlDial> {
  if (request.dial !== undefined) return ok(request.dial);
  const connected = cliDial({
    dataRoot: request.dataRoot,
    platform: request.platform,
    xdgRuntimeDir: request.env.get("XDG_RUNTIME_DIR"),
  });
  return connected.ok
    ? connected
    : err({ code: "unavailable", message: connected.error.message });
}

function ioOf(request: CliIo): Result<Io> {
  const dataRoot = dataRootOf(request);
  if (!dataRoot.ok) return dataRoot;
  const dial = dialOf({ ...request, dataRoot: dataRoot.value });
  if (!dial.ok) return dial;
  return ok({
    dial: dial.value,
    spawnDetached:
      request.spawnDetached ??
      spawnDetachedCore({
        platformRoot: request.platformRoot,
        dataRoot: dataRoot.value,
      }),
  });
}

function clientAt(
  baseUrl: string,
  token: string,
  fetch: RpcFetch | undefined,
): CommandCore {
  return clientCore(
    createCoreClient({
      baseUrl,
      token,
      ...(fetch === undefined ? {} : { fetch }),
    }),
  );
}

// 이미 서 있는 core에만 붙는다. 명시 주소가 있으면 identify가 알린 주소와 같은 core인지 먼저 확인하고,
// 다르면 자격을 받기 전에 실패한다. 한 core의 자격을 다른 loopback server로 보내지 않는다.
// ensure가 띄우는 core는 주소를 정하지 않는다.
// 기동 중(starting)인 core는 ready를 기다린다. core가 afterReady에서 부른 CLI가 control의 ready보다 먼저 닿을 수 있다.
async function joinRunning(
  io: Io,
  explicit: DaemonAddress | undefined,
): Promise<Result<{ apiUrl: string }, LophnError>> {
  const deadline = systemClock.nowMs() + STARTING_MS;
  let identified = await controlIdentify({ dial: io.dial });
  while (
    identified.ok &&
    identified.value.state === "starting" &&
    systemClock.nowMs() < deadline
  ) {
    await new Promise<void>((resolve) => TIMER.setTimeout(resolve, 100));
    identified = await controlIdentify({ dial: io.dial });
  }
  if (!identified.ok) return identified;
  const apiUrl = identified.value.api_url;
  if (apiUrl === null) {
    return err({ code: "unavailable", message: "core가 준비되지 않았다" });
  }
  if (explicit !== undefined && !sameCoreAddress(explicit.url, apiUrl)) {
    return err({
      code: "unavailable",
      message: `명시 daemon 주소(${explicit.url})가 core의 API 주소(${apiUrl})와 다르다`,
    });
  }
  return ok({ apiUrl: explicit?.url ?? apiUrl });
}

// agent turn 자격은 그것을 낸 core에만 쓴다. 자격 발급(connect)도, core 시작도 하지 않는다.
async function joinAsAgent(
  request: CliIo,
  io: Io,
  agent: string,
  explicit: DaemonAddress | undefined,
): Promise<Result<CliConnection, LophnError>> {
  const joined = await joinRunning(io, explicit);
  if (!joined.ok) return joined;
  return ok({
    core: clientAt(joined.value.apiUrl, agent, request.fetch),
    token: agent,
  });
}

// 명시 주소가 있으면 그 core에 붙기만 하고 띄우지 않는다. 자격은 같은 core의 connect로 받는다.
async function joinAtAddress(
  request: CliIo,
  io: Io,
  explicit: DaemonAddress,
): Promise<Result<CliConnection, LophnError>> {
  const joined = await joinRunning(io, explicit);
  if (!joined.ok) return joined;
  const connected = await controlConnect({ dial: io.dial }, "cli");
  if (!connected.ok) return connected;
  return ok({
    core: clientAt(
      joined.value.apiUrl,
      connected.value.user_token,
      request.fetch,
    ),
    token: connected.value.user_token,
  });
}

// 사람의 명령은 ensure 뒤에 부른다. core가 없으면 띄우고, 판이 다르면 한 번 갈아 띄운다.
async function ensureAndJoin(
  request: CliIo,
  io: Io,
): Promise<Result<CliConnection, LophnError>> {
  const ensured = await ensureCore(
    {
      dial: io.dial,
      spawnDetached: io.spawnDetached,
      clock: systemClock,
      timer: TIMER,
    },
    { client: "cli", productVersion: request.productVersion },
  );
  if (!ensured.ok) return err(ensured.error);
  return ok({
    core: clientAt(
      ensured.value.api_url,
      ensured.value.user_token,
      request.fetch,
    ),
    token: ensured.value.user_token,
  });
}

export async function openConnection(
  request: CliIo,
): Promise<Result<CliConnection, LophnError>> {
  const explicit = explicitDaemonAddress({
    env: request.env.get(LOPHN_DAEMON_URL),
  });
  if (!explicit.ok) return explicit;
  // 자격 없는 agent shell에서 사람 자격을 받거나 core를 새로 띄우지 않는다.
  if (inAgentShell(request.env)) {
    return err({
      code: "forbidden",
      message:
        'lophn commands do not run inside the shell tool. Call the lophn tool with the same words instead, e.g. args ["tab", "open", "--url", "https://example.com"].',
    });
  }
  const io = ioOf(request);
  if (!io.ok) return io;
  const agent = agentCredential(request.env, request.readCredential);
  if (agent !== undefined) {
    // turn 밖의 GUI 탭 CLI다. 사람 자격으로 바꾸지 않는다.
    if (agent.token === null) {
      return err({
        code: "unauthorized",
        message:
          "lophn commands run as this session's agent only during a lophn turn, and no turn is open now.",
      });
    }
    return joinAsAgent(request, io.value, agent.token, explicit.value);
  }
  if (explicit.value !== undefined) {
    return joinAtAddress(request, io.value, explicit.value);
  }
  return ensureAndJoin(request, io.value);
}

// `lophn core stop`. core를 띄우지 않고 control에 stop만 보낸다. agent turn 자격으로는 core를 멈출 수 없다.
export async function stopCore(request: {
  env: { get(name: string): string | undefined };
  dataRoot: string | undefined;
  platform: OsPlatform;
  dial?: ControlDial;
  readCredential?: ReadCredentialFile;
}): Promise<Result<null, LophnError>> {
  if (
    agentCredential(request.env, request.readCredential) !== undefined ||
    inAgentShell(request.env)
  ) {
    return err({
      code: "forbidden",
      message: "agent 자격으로는 core를 멈출 수 없다",
    });
  }
  const dataRoot = dataRootOf(request);
  if (!dataRoot.ok) return dataRoot;
  const dial = dialOf({ ...request, dataRoot: dataRoot.value });
  if (!dial.ok) return dial;
  return controlStop({ dial: dial.value });
}
