// 앱 화면 검사 host client. runner가 shell이 설치한 host 실행 파일을
// `--app-screen-test`로 child로 띄우고 상속 fd 3의 JSON lines로 입력 한 줄을 주고 관측 한 줄을
// 받는다. host는 사람 token·core 연결 없이 임시 userData·메모리 partition·offscreen으로
// 돈다. 여기서도 core·collector 주소와 credential, 실제 HOME을 child 환경에 주지 않는다.
// exit 0과 contract schema·frame 상한 안의 관측 한 줄일 때만 관측이다. exit 2·3·4, 기한, 잘못된
// 관측은 판정 불가이고 실행 파일을 띄울 수 없으면 unavailable이다. stdout은 판정에 쓰지 않는다.
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  SCREEN_TEST_FD,
  SCREEN_TEST_FLAG,
  type ScreenTestInput,
  screenTestInputSchema,
  screenTestLine,
  screenTestObservationSchema,
} from "../../../../protocol/shell/mod.ts";
import type { ScreenHostResult } from "../app-test/screens.ts";

// 관측 frame 상한. host도 같은 값으로 자른다.
export const SCREEN_OBSERVATION_MAX_BYTES = 65_536;
// host가 스스로 끝나는 기한(deadline_ms) 뒤에 runner가 더 기다리는 여유.
export const SCREEN_HOST_GRACE_MS = 30_000;

export type ScreenHostOptions = {
  // shell이 설치한 host 실행 파일의 절대 경로.
  command: string;
  // 실행 파일 앞에 붙는 인자. 개발 build는 `[main.cjs]`다.
  args?: readonly string[];
  input: ScreenTestInput;
  // runner 작업 폴더. HOME·LOPHN_HOME·TMPDIR가 이 안의 빈 폴더가 된다.
  work_dir: string;
};

const PASS_ENV = ["PATH", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"] as const;

async function childEnv(workDir: string): Promise<Record<string, string>> {
  const dirs = {
    HOME: `${workDir}/screen-home`,
    LOPHN_HOME: `${workDir}/screen-lophn-home`,
    TMPDIR: `${workDir}/screen-tmp`,
  };
  for (const dir of Object.values(dirs)) {
    await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const env: Record<string, string> = { ...dirs };
  for (const name of PASS_ENV) {
    const value = Deno.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function observationOf(text: string): ScreenHostResult {
  const inconclusive = (reason: string): ScreenHostResult => ({
    kind: "inconclusive",
    reason,
  });
  if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) {
    return inconclusive("관측이 한 줄 JSON이 아니다");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return inconclusive("관측이 JSON이 아니다");
  }
  const parsed = screenTestObservationSchema.safeParse(value);
  return parsed.success
    ? { kind: "observation", observation: parsed.data }
    : inconclusive("관측이 contract schema에 맞지 않는다");
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const all = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return all;
}

// host를 한 번 돌린다. 어떤 끝이든 자기가 띄운 process 그룹만 정리한다.
export async function runScreenHost(
  options: ScreenHostOptions,
): Promise<ScreenHostResult> {
  const input = screenTestInputSchema.parse(options.input);
  const env = await childEnv(options.work_dir);
  const child = spawn(
    options.command,
    [...(options.args ?? []), SCREEN_TEST_FLAG],
    { env, stdio: ["ignore", "pipe", "pipe", "pipe"], detached: true },
  );
  const spawned = await new Promise<string | null>((resolve) => {
    child.once("spawn", () => resolve(null));
    child.once("error", (error) => resolve(error.message));
  });
  if (spawned !== null || child.pid === undefined) {
    return { kind: "unavailable", reason: "host 실행 파일을 띄울 수 없다" };
  }
  const pid = child.pid;
  // 출력은 판정에 쓰지 않는다. 막히지 않게 비운다.
  child.stdout!.resume();
  child.stderr!.resume();
  const pipe = child.stdio[SCREEN_TEST_FD] as unknown as Readable & Writable;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let oversized = false;
  const kill = () => {
    try {
      Deno.kill(-pid, "SIGKILL");
    } catch { /* 이미 끝났다 */ }
  };
  pipe.on("data", (chunk: Uint8Array) => {
    size += chunk.byteLength;
    if (size > SCREEN_OBSERVATION_MAX_BYTES) {
      oversized = true;
      kill();
      return;
    }
    chunks.push(chunk);
  });
  pipe.on("error", () => {});
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, input.deadline_ms + SCREEN_HOST_GRACE_MS);
  const closed = new Promise<number | null>((resolve) =>
    child.once("close", (code) => resolve(code))
  );
  pipe.write(screenTestLine(input));
  const code = await closed;
  clearTimeout(timer);
  // 그룹에 남은 손자가 있으면 같이 회수한다.
  kill();
  if (timedOut) return { kind: "inconclusive", reason: "host 기한 초과" };
  if (oversized) {
    return { kind: "inconclusive", reason: "관측이 frame 상한을 넘었다" };
  }
  if (code !== 0) {
    return { kind: "inconclusive", reason: `host가 exit ${code}로 끝났다` };
  }
  return observationOf(new TextDecoder().decode(concat(chunks)));
}

// SDK 루트 오류 경계(AppErrorBoundary)가 render 오류를 알리는 DOM event 이름. 경계가 있는 화면
// 번들에는 이 글자가 남는다.
export const RENDER_ERROR_EVENT = "lophn:render-error";
const BOUNDARY_FILE = /\.(?:m?js|html)$/i;
const BOUNDARY_FILE_MAX_BYTES = 16 * 1024 * 1024;

async function textFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await textFiles(path));
    else if (entry.isFile() && BOUNDARY_FILE.test(entry.name)) found.push(path);
  }
  return found;
}

// 화면마다 그 화면 폴더 안에 루트 오류 경계의 글자가 있는지 본다. symlink는 따라가지 않는다.
export async function screenErrorBoundaries(
  input: Pick<ScreenTestInput, "bundle_screens_dir" | "screens">,
): Promise<Set<string>> {
  const has = new Set<string>();
  for (const screen of input.screens) {
    const dir = join(input.bundle_screens_dir, dirname(screen.path));
    let files: string[];
    try {
      files = await textFiles(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const bytes = await readFile(file).catch(() => null);
      if (
        bytes !== null && bytes.byteLength <= BOUNDARY_FILE_MAX_BYTES &&
        bytes.includes(RENDER_ERROR_EVENT)
      ) {
        has.add(screen.key);
        break;
      }
    }
  }
  return has;
}
