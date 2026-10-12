import { err, ok, type Result } from "../../../../base/mod.ts";

// stdio MCP 전송(concern lophn-agent/extensions, requirements
// lophn-agent/extensions#R13, R14, R21). 절대 executable과 인자를 Deno.Command로
// shell 없이 시작한다(R14). 환경은 clearEnv 뒤 실행 파일 탐색·홈·임시 폴더·문자
// 인코딩에 필요한 네 값(PATH·HOME·TEMP·LC_ALL)과 그 서버에 지정한 명시 env뿐이다.
// 다른 연결이나 provider의 env·비밀은 상속하지 않는다(R14). shell 메타문자가 든
// 인자는 그 글 그대로 전달된다(R14). stderr는 크기를 제한해 읽고 redaction된
// 진단만 남긴다(architecture §2.3, §5.5). 종료는 stdin 닫기 뒤 5초 grace이고
// 남으면 강제 종료한다(R21).

//SIGKILL 전 대기다(R21).
export const STDIO_KILL_GRACE_MS = 5_000;

// stderr 원문의 상한이다(architecture §2.3 크기 제한). 넘으면 뒤를 버린다.
export const STDERR_MAX_BYTES = 64 * 1024;

// 자식 진입에 넘기는 최소 env 이름이다(R14, architecture §2.3). 그 밖의
// process env는 server에 가지 않는다.
export const STDIO_AMBIENT_ENV = ["PATH", "HOME", "TEMP", "LC_ALL"] as const;

// 서버 설정에서 자식 env를 만든다(R14). ambient는 호출 process의 env 읽기다.
// secret 값은 연결 부착 경계에서 이미 결정된 글만 온다(R14, architecture §5.5).
export function stdioChildEnv(
  explicit: Record<string, string>,
  ambient: (name: string) => string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of STDIO_AMBIENT_ENV) {
    const value = ambient(name);
    if (value !== undefined) env[name] = value;
  }
  // 명시 env는 ambient를 덮는다. 그 서버에 지정한 값들이다(R14).
  for (const [name, value] of Object.entries(explicit)) {
    env[name] = value;
  }
  return env;
}

// shell 메타문자가 든 인자가 그대로 전달되는지 본다(R14). Deno.Command는
// 인자 배열을 그대로 execve에 넣으므로 그 자체가 보장이고, 이 모듈은
// 내부에서 문자열을 이어 붙이거나 shell을 부르지 않는다.
export const STDIO_NO_SHELL = true;

export type StdioSpawn = {
  // 자식 process다. pid는 강제 종료가 쓴다(R21).
  pid: number;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  // stderr의 redaction된 진단이다. 상한을 넘으면 잘린다(architecture §2.3).
  stderrText(): string;
  exited: Promise<Deno.CommandStatus>;
  // stdin 닫기 → 5초 grace → SIGKILL이다(R21). 여러 번 불러도 된다.
  close(): Promise<void>;
  // grace 없이 즉시 강제 종료다(테스트·비상). 시작한 pid만 끝낸다.
  kill(): Promise<void>;
};

export type StdioSpawnInput = {
  executable: string;
  args: readonly string[];
  cwd: string | null;
  // 이미 결정된 값 그대로다. secret_ref는 부르는 쪽이 풀어서 준다(R14).
  env: Record<string, string>;
  // 호출 process의 env 읽기다. 없는 이름은 넘기지 않는다(R14).
  ambient?: (name: string) => string | undefined;
};

// 절대 executable과 인자를 shell 없이 시작한다(R14). cwd는 등록 값이고
// model 입력에서 받지 않는다(architecture §2.3).
export function spawnStdioMcp(
  input: StdioSpawnInput,
): Result<StdioSpawn> {
  if (
    !input.executable.startsWith("/") && !/^[A-Za-z]:\\/.test(input.executable)
  ) {
    return err({
      code: "invalid_input",
      message: "stdio executable은 절대 경로다",
    });
  }
  let command: Deno.Command;
  try {
    command = new Deno.Command(input.executable, {
      args: [...input.args],
      cwd: input.cwd ?? undefined,
      // clearEnv 뒤 네 값과 그 서버에 지정한 env만 넣는다(R14).
      clearEnv: true,
      env: stdioChildEnv(
        input.env,
        input.ambient ?? ((name) => Deno.env.get(name)),
      ),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
  } catch {
    return err({
      code: "invalid_input",
      message: "stdio executable을 시작하지 못했다",
    });
  }
  let child: Deno.ChildProcess;
  try {
    child = command.spawn();
  } catch {
    return err({
      code: "invalid_input",
      message: "stdio executable을 시작하지 못했다",
    });
  }
  const stderr = limitStderr(child.stderr, STDERR_MAX_BYTES);
  const exited = child.status;
  let closed = false;
  return ok({
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
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
        await child.stdin.close();
      } catch { /* 이미 닫혔다 */ }
      const exitedWithinGrace = await Promise.race([
        exited.then(() => true, () => false),
        new Promise<false>((resolve) => {
          setTimeout(() => resolve(false), STDIO_KILL_GRACE_MS);
        }),
      ]);
      if (!exitedWithinGrace) {
        try {
          child.kill("SIGKILL");
        } catch { /* 이미 끝났다 */ }
      }
      await exited.catch(() => undefined);
      await stderr.done;
    },
    async kill() {
      closed = true;
      try {
        child.kill("SIGKILL");
      } catch { /* 이미 끝났다 */ }
      await exited.catch(() => undefined);
      await stderr.done;
    },
  });
}

// stderr를 상한 안에서 읽는다(architecture §2.3). text는 redaction 전 원문이고
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
    } catch { /* 끊긴 pipe는 조용히 넘어간다 */ }
  })();
  return { text: () => text, done };
}
