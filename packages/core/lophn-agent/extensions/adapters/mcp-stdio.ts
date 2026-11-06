import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { Readable, Writable } from "node:stream";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { WINDOWS_ENV_NAMES } from "../../../supervision/security/child-env.ts";
import {
  killTree,
  treeSpawnOptions,
} from "../../../supervision/security/tree-kill.ts";

// stdio MCP 전송.
// 절대 executable과 인자를 node:child_process의 spawn으로
// shell 없이 시작한다. 환경은 부모 env를 물려받지 않고 실행 파일 탐색·홈·임시 폴더·문자
// 인코딩에 필요한 네 값(PATH·HOME·TEMP·LC_ALL)과 그 서버에 지정한 명시 env뿐이다.
// 다른 연결이나 provider의 env·비밀은 상속하지 않는다. shell 메타문자가 든
// 인자는 그 글 그대로 전달된다. stderr는 크기를 제한해 읽고 redaction된
// 진단만 남긴다. 종료는 stdin 닫기 뒤 5초 grace이고
// 남으면 강제 종료한다.

//SIGKILL 전 대기다.
const STDIO_KILL_GRACE_MS = 5_000;

// stderr 원문의 상한이다. 넘으면 뒤를 버린다.
const STDERR_MAX_BYTES = 64 * 1024;

// 자식 진입에 넘기는 최소 env 이름이다. 그 밖의
// process env는 server에 가지 않는다.
const STDIO_AMBIENT_ENV = ["PATH", "HOME", "TEMP", "LC_ALL"] as const;

// 서버 설정에서 자식 env를 만든다. ambient는 호출 process의 env 읽기다.
// secret 값은 연결 부착 경계에서 이미 결정된 글만 온다.
function stdioChildEnv(
  explicit: Record<string, string>,
  ambient: (name: string) => string | undefined,
  platform: string = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  const names =
    platform === "win32"
      ? [...STDIO_AMBIENT_ENV, ...WINDOWS_ENV_NAMES]
      : STDIO_AMBIENT_ENV;
  for (const name of names) {
    const value = ambient(name);
    if (value !== undefined) env[name] = value;
  }
  // 명시 env는 ambient를 덮는다. 그 서버에 지정한 값들이다.
  for (const [name, value] of Object.entries(explicit)) {
    env[name] = value;
  }
  return env;
}

// shell 메타문자가 든 인자가 그대로 전달되는지 본다. spawn은
// 인자 배열을 그대로 execve에 넣으므로 그 자체가 보장이고, 이 모듈은
// 내부에서 문자열을 이어 붙이거나 shell을 부르지 않는다.

export type StdioSpawn = {
  // 자식 process다. pid는 강제 종료가 쓴다.
  pid: number;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  // stderr의 redaction된 진단이다. 상한을 넘으면 잘린다.
  stderrText(): string;
  exited: Promise<{ code: number | null; signal: string | null }>;
  // stdin 닫기 → 5초 grace → SIGKILL이다. 여러 번 불러도 된다.
  close(): Promise<void>;
  // grace 없이 즉시 강제 종료다(테스트·비상). 시작한 pid만 끝낸다.
  kill(): Promise<void>;
};

export type StdioSpawnInput = {
  executable: string;
  args: readonly string[];
  cwd: string | null;
  // 설정의 값 그대로다. stdio env는 secret을 받지 않는다.
  env: Record<string, string>;
  // 호출 process의 env 읽기다. 없는 이름은 넘기지 않는다.
  ambient?: (name: string) => string | undefined;
};

// Node는 env를 명시해도 부모의 NODE_V8_COVERAGE를 child에 넘긴다(coverage 수집용). 서버 설정이 직접 준
// 경우만 그대로 보내고, 아니면 빈 값으로 수집을 끈다(빈 NODE_V8_COVERAGE는 수집하지 않는다).
function narrowEnv(env: Record<string, string>): Record<string, string> {
  return { NODE_V8_COVERAGE: "", ...env };
}

// 절대 executable과 인자를 shell 없이 시작한다. cwd는 등록 값이고
// model 입력에서 받지 않는다.
export function spawnStdioMcp(input: StdioSpawnInput): Result<StdioSpawn> {
  if (
    !input.executable.startsWith("/") &&
    !/^[A-Za-z]:\\/.test(input.executable)
  ) {
    return err({
      code: "invalid_input",
      message: "stdio executable은 절대 경로다",
    });
  }
  let child: ChildProcess;
  try {
    child = spawn(input.executable, [...input.args], {
      cwd: input.cwd ?? undefined,
      // 부모 env를 물려받지 않고 네 값과 그 서버에 지정한 env만 넣는다. env를 주면 부모 env를 상속하지 않는다.
      env: narrowEnv(
        stdioChildEnv(
          input.env,
          input.ambient ?? ((name) => process.env[name]),
        ),
      ),
      stdio: ["pipe", "pipe", "pipe"],
      ...treeSpawnOptions(),
    });
  } catch {
    return err({
      code: "invalid_input",
      message: "stdio executable을 시작하지 못했다",
    });
  }
  // spawn 실패(ENOENT 등)의 'error'를 받지 않으면 core 전체가 죽는다. 실패는 pid로 판정한다.
  child.on("error", () => {});
  const pid = child.pid;
  if (pid === undefined) {
    return err({
      code: "invalid_input",
      message: "stdio executable을 시작하지 못했다",
    });
  }
  const stdin = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
  const stdout = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  const stderr = limitStderr(
    Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
    STDERR_MAX_BYTES,
  );
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      // close가 아니라 exit다. 상속한 pipe를 쥔 손자가 남아도 종료는 이 process의 exit다.
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  let closed = false;
  return ok({
    pid,
    stdin,
    stdout,
    stderrText: () => stderr.text(),
    exited,
    async close() {
      if (closed) {
        await exited.catch(() => undefined);
        return;
      }
      closed = true;
      // stdin 닫기가 서버의 정상 종료 신호다(MCP stdio 수명).
      try {
        await stdin.close();
      } catch {
        /* 이미 닫혔다 */
      }
      const exitedWithinGrace = await Promise.race([
        exited.then(
          () => true,
          () => false,
        ),
        new Promise<false>((resolve) => {
          setTimeout(() => resolve(false), STDIO_KILL_GRACE_MS);
        }),
      ]);
      if (!exitedWithinGrace) killTree(child);
      await exited.catch(() => undefined);
      await stderr.done;
    },
    async kill() {
      closed = true;
      killTree(child);
      await exited.catch(() => undefined);
      await stderr.done;
    },
  });
}

// stderr를 상한 안에서 읽는다. text는 redaction 전 원문이고
// 부르는 쪽이 redaction해서 진단으로 쓴다. 버퍼가 상한을 넘으면 뒤를 버린다.
function limitStderr(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): { text(): string; done: Promise<void> } {
  let text = "";
  let size = 0;
  const done = (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size <= maxBytes) {
          text += decoder.decode(chunk.value, { stream: true });
        }
        // 상한을 넘으면 읽어서 버린다(drain 없으면 자식이 멈춘다).
      }
    } catch {
      /* 끊긴 pipe는 조용히 넘어간다 */
    }
  })();
  return { text: () => text, done };
}
