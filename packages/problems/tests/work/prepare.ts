import { err, ok, type Result } from "../../../base/mod.ts";
import type { TestMethod } from "../../../contracts/problems/mod.ts";
import { testMethodInputSchema } from "../../../contracts/problems/mod.ts";
import { FIXED_DENO_FLAGS, RUNNER_LIMITS, SAFE_ENV_NAMES } from "./limits.ts";

const REJECT = "테스트 실행 방법을 거절했다";

export type PreparedCommand = {
  // 실행 파일은 runner가 고른 Deno 절대 경로다. argv에 넣지 않는다.
  executable: string;
  args: string[];
  cwd: string;
  timeout_ms: number;
  env: Record<string, string>;
};

export type PrepareInput = {
  method: TestMethod;
  // 고정 source root. cwd는 이 안의 상대 경로다.
  source: string;
  // side scratch. 쓰기 권한은 여기만 준다.
  scratch: string;
  // 읽기 전용 고정 경로. source·의존·harness.
  reads: readonly string[];
  // 명시한 안전 변수만. 목록 밖 이름은 거절한다.
  env: Record<string, string>;
  // runner가 고른 Deno. 절대 경로여야 한다.
  deno: string;
};

function reject(): Result<never> {
  return err({ code: "invalid_input", message: REJECT });
}

function inside(root: string, path: string): boolean {
  const base = root.endsWith("/") ? root : `${root}/`;
  return path === root || path.startsWith(base);
}

// shell 문법, native 실행 파일, `..`, 절대 경로, 넓은 권한 flag는 schema가 먼저 거절한다.
// 여기는 OS 경로와 timeout 누락, 환경 이름까지 본다(problems/tests#R14, R16, R19).
export function prepareCommand(
  input: PrepareInput,
): Result<PreparedCommand> {
  const parsed = testMethodInputSchema.safeParse(input.method);
  if (!parsed.success) return reject();
  const method = parsed.data;
  if (!Number.isFinite(method.timeout_ms) || method.timeout_ms < 1) {
    return reject();
  }
  if (method.timeout_ms > RUNNER_LIMITS.timeout_ms) return reject();
  if (!input.deno.startsWith("/") || input.deno.includes("\0")) return reject();
  if (!input.source.startsWith("/") || !input.scratch.startsWith("/")) {
    return reject();
  }
  const cwd = input.method.cwd === "."
    ? input.source
    : `${input.source.replace(/\/$/, "")}/${input.method.cwd}`;
  if (!inside(input.source, cwd)) return reject();
  for (const name of Object.keys(input.env)) {
    if (!(SAFE_ENV_NAMES as readonly string[]).includes(name)) return reject();
  }
  const reads = [input.source, ...input.reads];
  for (const path of reads) {
    if (!path.startsWith("/") || path.includes("\0")) return reject();
  }
  // 요청 argv의 권한 flag는 받지 않는다. runner가 고정 flag와 좁은 권한만 붙인다.
  const entry = method.argv.filter((arg) => !arg.startsWith("-"));
  return ok({
    executable: input.deno,
    args: [
      ...FIXED_DENO_FLAGS,
      "test",
      `--allow-read=${reads.join(",")}`,
      `--allow-write=${input.scratch}`,
      ...entry.slice(1),
    ],
    cwd,
    timeout_ms: method.timeout_ms,
    env: { ...input.env },
  });
}

// 묶음 밖 symlink·`..` real path는 시작 전에 거절한다(problems/tests#R16).
export async function rejectOutside(
  root: string,
  path: string,
): Promise<boolean> {
  if (!inside(root, path) && path !== root) return true;
  try {
    const real = await Deno.realPath(path);
    return !inside(root, real) && real !== root;
  } catch {
    return true;
  }
}
