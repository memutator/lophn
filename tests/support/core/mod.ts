import type { z } from "zod";
import {
  createIdSource,
  cryptoRandom,
  type IdSource,
  type Result,
  systemClock,
} from "../../../packages/base/mod.ts";
import {
  createRpcClient,
  type RpcFetch,
} from "../../../packages/protocol/client/mod.ts";
import {
  errorBodySchema,
  type Route,
  UPLOAD_INPUT_HEADER,
} from "../../../packages/protocol/base/mod.ts";
import { spawnCore, tail, waitGone } from "./process.ts";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const SETTINGS_FILE = "settings.json";

export type Run = {
  /** <repo>/.dev-data/e2e/<Deno.makeTempDir가 정한 이름> */
  dir: string;
  /** dir/home. LOPHN_HOME(0700) */
  home: string;
  /** dir/work. project 폴더 등. data root 밖 */
  work: string;
  /** chmod -R u+w 한 뒤 dir 통째로 지운다. */
  remove(): Promise<void>;
};

export type Input<R extends Route> = z.input<R["input"]>;
export type Output<R extends Route> = R extends { output: infer O }
  ? O extends z.ZodType ? z.output<O> : never
  : never;
// route 객체는 compare schema의 구체 type을 잃어 ZodType으로만 안다. 값은 envelope 검사가 거른다.
type Compare<R extends Route> = R extends { compare?: z.ZodType }
  ? Record<string, unknown>
  : never;

export type Core = {
  run: Run;
  /** http://127.0.0.1:<api_port> */
  baseUrl: string;
  /** hello frame의 user_token */
  token: string;
  /** 오류면 code를 담아 throw한다. */
  call<R extends Route>(
    route: R,
    input: Input<R>,
    compare?: Compare<R>,
  ): Promise<Output<R>>;
  /** 오류 code를 단정할 때 쓴다. */
  tryCall<R extends Route>(
    route: R,
    input: Input<R>,
    compare?: Compare<R>,
  ): Promise<Result<Output<R>>>;
  /** secrets/put. createRpcClient는 upload route를 못 부른다. */
  upload(name: string, bytes: Uint8Array): Promise<Result<unknown>>;
  /** SIGKILL(crash 흉내). core의 child까지 없는 것을 확인한 뒤 돌아온다. */
  kill(): Promise<void>;
  /** stdin을 닫는 정상 종료. 같은 확인을 한다. */
  stop(): Promise<void>;
  /** dir/core.log. core의 stderr */
  logPath: string;
  /** command 봉투와 human helper가 쓰는 id 원천. */
  ids: IdSource;
};

export class CallError extends Error {
  constructor(
    readonly route: string,
    readonly code: string,
    message: string,
  ) {
    super(`${route}: ${code}: ${message}`);
  }
}

export async function createRun(): Promise<Run> {
  const root = `${REPO}/.dev-data/e2e`;
  await Deno.mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await Deno.makeTempDir({ dir: root, prefix: "run-" });
  const home = `${dir}/home`;
  const work = `${dir}/work`;
  await Deno.mkdir(home, { mode: 0o700 });
  await Deno.mkdir(work);
  await Deno.mkdir(`${dir}/user-home`);
  return { dir, home, work, remove: () => removeDir(dir) };
}

// core가 깐 sdk 사본이 읽기 전용(폴더 0555)이라 폴더마다 쓰기 권한을 돌려준 뒤 지운다.
async function removeDir(dir: string): Promise<void> {
  async function open(directory: string): Promise<void> {
    await Deno.chmod(directory, 0o755);
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isDirectory) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await open(dir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  await Deno.remove(dir, { recursive: true });
}

const rpcFetch: RpcFetch = async (input, init) => {
  const response = await fetch(input, init);
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
};

function encodeInput(input: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}

async function writeSettings(
  run: Run,
  settings: Record<string, unknown> | undefined,
): Promise<void> {
  const path = `${run.home}/${SETTINGS_FILE}`;
  try {
    await Deno.stat(path);
    return;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  // 선언 안 된 key가 하나라도 있으면 file 전체가 거절된다. models.dev 요청은 끈다.
  const body = { "lophn-agent.model.catalog_auto_update": false, ...settings };
  await Deno.writeTextFile(path, JSON.stringify(body), {
    create: true,
    mode: 0o600,
  });
}

export type BootOptions = {
  settings?: Record<string, unknown>;
  /** core process의 env에 더하는 값(예 DENO_DIR, XDG_RUNTIME_DIR). LOPHN_HOME·HOME·PATH는 덮지 못한다. */
  env?: Record<string, string>;
};

export type StartResult =
  | { ok: true; core: Core }
  | { ok: false; reason: string; exit: number | null };

export async function bootCore(
  run: Run,
  options: BootOptions = {},
): Promise<Core> {
  const started = await startCore(run, options);
  if (!started.ok) {
    throw new Error(
      `core 시작 실패: ${started.reason}\n--- core.log ---\n${await tail(
        `${run.dir}/core.log`,
      )}`,
    );
  }
  return started.core;
}

// bootCore와 tryBootCore(try-boot.ts)가 같이 쓴다. 시작 실패를 던지지 않고 값으로 돌려준다.
export async function startCore(
  run: Run,
  options: BootOptions = {},
): Promise<StartResult> {
  await writeSettings(run, options.settings);
  const logPath = `${run.dir}/core.log`;
  const result = await spawnCore(
    run.home,
    `${run.dir}/user-home`,
    logPath,
    options.env,
  );
  if (!result.ok) return result;
  const spawned = result;
  const { user_token: token, api_port: port } = spawned.hello;
  const baseUrl = `http://127.0.0.1:${port}`;
  const ids: IdSource = createIdSource({
    clock: systemClock,
    random: cryptoRandom,
  });
  const rpc = createRpcClient({ baseUrl, token, fetch: rpcFetch });
  let ended = false;

  async function end(how: () => void): Promise<void> {
    if (ended) return;
    ended = true;
    how();
    await spawned.exited;
    const left = await waitGone(run.home);
    if (left.length > 0) {
      throw new Error(
        `core가 child를 남긴다: pid ${left.join(", ")} (SIGKILL로 정리함)`,
      );
    }
  }

  const tryCall: Core["tryCall"] = async (route, input, compare) => {
    const body = route.kind === "command"
      ? {
        input,
        idempotency_key: ids.newId("idk"),
        compare: compare ?? {},
        prepared: [],
      }
      : input;
    return await rpc.call(route, body as never) as Result<never>;
  };

  const core: Core = {
    run,
    baseUrl,
    token,
    logPath,
    ids,
    tryCall,
    async call(route, input, compare) {
      const result = await tryCall(route, input, compare);
      if (!result.ok) {
        throw new CallError(
          route.name,
          result.error.code,
          result.error.message,
        );
      }
      return result.value;
    },
    async upload(name, bytes) {
      const response = await fetch(`${baseUrl}/secrets/put`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
          [UPLOAD_INPUT_HEADER]: encodeInput({ name, bytes: bytes.length }),
        },
        body: bytes as Uint8Array<ArrayBuffer>,
      });
      const json = await response.json().catch(() => undefined);
      if (response.status === 200) return { ok: true, value: json };
      const parsed = errorBodySchema.safeParse(json);
      return {
        ok: false,
        error: parsed.success ? parsed.data.error : {
          code: "internal",
          message: `status ${response.status}`,
        },
      };
    },
    kill: () => end(() => spawned.signal("SIGKILL")),
    stop: () => end(() => void spawned.closeStdin()),
  };
  return { ok: true, core };
}
