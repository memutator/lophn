import { err, ok, type Result } from "../../../../base/mod.ts";
import type { TestMethod } from "../../../../protocol/problems/mod.ts";
import { testMethodInputSchema } from "../../../../protocol/problems/mod.ts";
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
  // runner가 고른 앱 import map(runner 설치 자료)이다. 요청의 argv가 아니라 이 값만 `--import-map`이 된다.
  // 있으면 자식은 `--no-config`로 뜬다: 고정 source의 deno.json·lock을 읽지 않는다.
  import_map?: string;
  // 자식 프로세스의 환경에만 들어가는 runner 값(HOME·DENO_DIR). `--allow-env`에는 들어가지 않는다.
  runtime_env?: Record<string, string>;
  // 접수한 요청의 실행 기한이다. method의 timeout_ms보다 길어지지 않는다(짧은 쪽을 쓴다).
  request_timeout_ms?: number;
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
  const requested = input.request_timeout_ms;
  if (
    requested !== undefined &&
    (!Number.isInteger(requested) || requested < 1 ||
      requested > RUNNER_LIMITS.timeout_ms)
  ) return reject();
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
  // `-`로 시작하는 요청 argv는 권한 flag일 수 있다. 조용히 버리지 않고 거절한다.
  if (method.argv.slice(1).some((arg) => arg.startsWith("-"))) return reject();
  const envNames = Object.keys(input.env);
  // `--no-prompt` 같은 전역 flag는 서브커맨드 앞에 둔다. deno 2.9는
  // `test --no-prompt`를 거절한다.
  if (input.import_map !== undefined) {
    if (!input.import_map.startsWith("/") || input.import_map.includes("\0")) {
      return reject();
    }
  }
  const args = [
    "test",
    ...FIXED_DENO_FLAGS,
    ...(input.import_map === undefined
      ? []
      : ["--no-config", `--import-map=${input.import_map}`]),
    `--allow-read=${reads.join(",")}`,
    `--allow-write=${input.scratch}`,
  ];
  // 안전 변수를 넘길 때만 그 이름만 --allow-env에 넣는다. 없으면 env 권한도 없다.
  if (envNames.length > 0) {
    args.push(`--allow-env=${envNames.join(",")}`);
  }
  args.push(...method.argv.slice(1));
  return ok({
    executable: input.deno,
    args,
    cwd,
    timeout_ms: Math.min(method.timeout_ms, requested ?? method.timeout_ms),
    env: { ...input.env, ...(input.runtime_env ?? {}) },
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
