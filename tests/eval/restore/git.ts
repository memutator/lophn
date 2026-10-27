import { spawn } from "node:child_process";
import process from "node:process";

// 사람의 git 설정(서명, hook, 이름)을 읽지 않는다. `tests/support/app/source.ts`의 createAppSource와 같은 설정이다.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function gitBytes(
  cwd: string,
  ...args: string[]
): Promise<Uint8Array> {
  const child = spawn("git", [
    "-c",
    "user.name=eval",
    "-c",
    "user.email=eval@example.invalid",
    "-c",
    "commit.gpgsign=false",
    ...args,
  ], {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
  // close는 stdout·stderr를 다 읽은 뒤에 온다.
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  if (code !== 0) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(concat(stderr))}`,
    );
  }
  return concat(stdout);
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return new TextDecoder().decode(await gitBytes(cwd, ...args)).trim();
}
