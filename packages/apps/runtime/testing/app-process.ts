// 시험 전용: 실제 앱 자식 프로세스를 temp 폴더에 띄운다. mod.ts에서 내보내지 않는다.
// 앱 진입 파일·blueprint·import map을 temp 폴더에 쓰고, 운영 앱 자식과 같은 Deno flag
// 모양(`--no-config --no-remote --no-npm --cached-only`와 폴더 한정 읽기·쓰기)으로 띄운다.
// bundle hash는 실제 쓴 파일 내용의 sha256이다.
import { sha256Hex } from "../../../base/mod.ts";
import { appFlags } from "../../permissions/mod.ts";

export const FIXTURE_APP = "app_01arz3ndektsv4rrffq69g5fav";
export const FIXTURE_RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";

function command(
  key: string,
  effect: "read" | "write" | "external",
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: effect === "write"
      ? { supported: true, command: "usage.undo" }
      : { supported: false },
    ...extra,
  };
}

// 화면 두 개(크기가 다르다)와 읽기·쓰기·관리·느림·실패 command를 가진 blueprint다.
export function fixtureBlueprint(): Record<string, unknown> {
  return {
    name: "Usage",
    description: "Reads usage",
    screens: [
      {
        key: "usage",
        label: "Usage",
        path: "/usage",
        sizes: ["full", "panel"],
      },
      {
        key: "overview",
        label: "Overview",
        path: "/overview",
        sizes: ["full", "panel", "card"],
      },
    ],
    commands: [
      command("usage.undo", "write", { revert: { supported: false } }),
      command("usage.read", "read"),
      command("usage.save", "write"),
      command("usage.admin", "write"),
      command("slow", "read"),
      command("fail", "read"),
      // 자식이 시작 입력으로 받은 broker credential을 돌려준다(시험 전용).
      command("credential", "read"),
      // 자기 log에 credential 모양 문자열을 찍는다(시험 전용). write라 invocation을 돌려준다.
      command("leak", "write"),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  };
}

export const SCREENS = {
  usage: ["full", "panel"],
  overview: ["full", "panel", "card"],
} as const;

export const COMMANDS = [
  "usage.undo",
  "usage.read",
  "usage.save",
  "usage.admin",
  "slow",
  "fail",
  "credential",
  "leak",
];

export type FixtureApp = {
  app: string;
  release: string | null;
  mode: "live" | "preview";
  bundleHash: string;
  nonce: string;
  endpoint: string;
  pid: number;
  dir: string;
  // 지금까지 자식이 stdout·stderr에 쓴 것.
  output(): string;
  exited: Promise<Deno.CommandStatus>;
  // 자식을 끝내고 temp 폴더를 지운다. 여러 번 불러도 된다.
  stop(): Promise<void>;
};

export type FixtureAppOptions = {
  verifyKey: string;
  app?: string;
  release?: string | null;
  mode?: "live" | "preview";
  nonce?: string;
  blueprint?: Record<string, unknown>;
  // 앱 자식 entry의 URL. 없으면 이 폴더의 app-child.ts(command를 되돌려 주는 handler)다.
  child?: string;
};

// 앱 폴더(진입 파일·blueprint·import map)만 만든다. 자식은 띄우지 않는다.
export async function writeFixtureBundle(
  dir: string,
  blueprint: Record<string, unknown> = fixtureBlueprint(),
  childUrl?: string,
): Promise<{ entry: string; importMap: string; bundleHash: string }> {
  const child = childUrl ?? new URL("./app-child.ts", import.meta.url).href;
  const entrySource = `import ${JSON.stringify(child)};\n`;
  const blueprintSource = JSON.stringify(blueprint);
  await Deno.writeTextFile(`${dir}/main.ts`, entrySource);
  await Deno.writeTextFile(`${dir}/blueprint.json`, blueprintSource);
  const importMap = `${dir}/import-map.json`;
  await Deno.writeTextFile(
    importMap,
    JSON.stringify({
      imports: {
        "@lophn/base": new URL("../../../base/mod.ts", import.meta.url).href,
        "@lophn/apps/blueprint":
          new URL("../../blueprint/mod.ts", import.meta.url).href,
      },
    }),
  );
  const bundleHash = await sha256Hex(`${entrySource}\n${blueprintSource}`);
  return { entry: `${dir}/main.ts`, importMap, bundleHash };
}

// 운영 앱 자식과 같은 argv다. Deno flag는 apps/permissions가 계산한 그대로이고(폴더 밖 읽기·쓰기는
// 없고 net은 두 socket과 가상 host뿐이다) 실제 프로세스가 그 flag로 뜬다.
export function fixtureArgv(
  dir: string,
  entry: string,
  importMap: string,
): string[] {
  const flags = appFlags(
    [],
    {
      bundle: dir,
      data: `${dir}/data`,
      brokerSocket: `${dir}/b.sock`,
      directSocket: `${dir}/a.sock`,
    },
    { ports: [] },
    [],
  );
  if (!flags.ok) throw new Error(flags.error.message);
  return ["run", ...flags.value.args, `--import-map=${importMap}`, entry];
}

export function startLineOf(input: {
  app: string;
  release: string | null;
  bundleHash: string;
  mode: "live" | "preview";
  nonce: string;
  dir: string;
  verifyKey: string;
}): string {
  return JSON.stringify({
    app: input.app,
    release: input.release,
    bundle_hash: input.bundleHash,
    mode: input.mode,
    process_nonce: input.nonce,
    broker_socket: `${input.dir}/b.sock`,
    direct_socket: `${input.dir}/a.sock`,
    data_path: `${input.dir}/data`,
    broker_credential: "fixture-broker-credential",
    verify_key: input.verifyKey,
  });
}

async function listening(path: string, exited: Promise<unknown>) {
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  for (let attempt = 0; attempt < 600; attempt++) {
    if (gone) throw new Error("fixture app exited before it listened");
    try {
      const connection = await Deno.connect({ path, transport: "unix" });
      connection.close();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("fixture app never listened");
}

export async function startFixtureApp(
  options: FixtureAppOptions,
): Promise<FixtureApp> {
  const dir = await Deno.makeTempDir({ prefix: "lop-" });
  await Deno.mkdir(`${dir}/data`);
  const bundle = await writeFixtureBundle(
    dir,
    options.blueprint,
    options.child,
  );
  const app = options.app ?? FIXTURE_APP;
  const mode = options.mode ?? "live";
  const release = options.release === undefined
    ? (mode === "live" ? FIXTURE_RELEASE : null)
    : options.release;
  const nonce = options.nonce ?? crypto.randomUUID();
  const process = new Deno.Command(Deno.execPath(), {
    args: fixtureArgv(dir, bundle.entry, bundle.importMap),
    clearEnv: true,
    env: {
      ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
      ...(Deno.env.get("DENO_DIR")
        ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
        : {}),
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let text = "";
  const decoder = new TextDecoder();
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) text += decoder.decode(chunk);
  };
  const reading = Promise.all([
    collect(process.stdout),
    collect(process.stderr),
  ]);
  const writer = process.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(
      `${
        startLineOf({
          app,
          release,
          bundleHash: bundle.bundleHash,
          mode,
          nonce,
          dir,
          verifyKey: options.verifyKey,
        })
      }\n`,
    ),
  );
  await writer.close();
  const exited = process.status;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      process.kill("SIGKILL");
    } catch { /* 이미 끝났다 */ }
    await exited;
    await reading.catch(() => undefined);
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  };
  try {
    await listening(`${dir}/a.sock`, exited);
  } catch (error) {
    const output = text;
    await stop();
    throw new Error(`${(error as Error).message}\n${output}`);
  }
  return {
    app,
    release,
    mode,
    bundleHash: bundle.bundleHash,
    nonce,
    endpoint: `${dir}/a.sock`,
    pid: process.pid,
    dir,
    output: () => text,
    exited,
    stop,
  };
}
