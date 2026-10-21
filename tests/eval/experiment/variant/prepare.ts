import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import type { VariantIo } from "./io.ts";

const E2E_DENO_DIR = ".dev-data/e2e/deno-dir";
const CORE_ENTRIES = [
  "packages/core/main/daemon/main.ts",
  "packages/core/main/agent-runtime/main.ts",
  "packages/core/main/app-supervisor/main.ts",
  "packages/core/main/worker/main.ts",
];

// 이미 한 일이면 다시 해도 같다.
export async function prepareVariant(
  path: string,
  current: string,
  io: VariantIo,
): Promise<Result<void>> {
  // worktree가 npm ci 없이 check를 돌게 한다. gate의 deno task check가 필요로 한다.
  const prep = await io.run(
    [
      Deno.execPath(),
      "run",
      "--allow-all",
      `${current}/tools/worktree-prep.ts`,
      path,
    ],
    current,
  );
  if (prep.code !== 0) {
    return err({
      code: "unavailable",
      message: `worktree-prep이 실패했다: ${prep.stderr.trim()}`,
    });
  }

  // gate의 e2e가 variant의 tests/support/app/deps.ts로 이 폴더를 읽는다. 현재 checkout 것을 symlink로 이으면
  // 앱 release 준비의 esbuild가 떨어지므로 variant가 자기 deps를 받는다.
  if (!await io.nonEmpty(`${path}/${E2E_DENO_DIR}`)) {
    const deps = await io.run([Deno.execPath(), "task", "e2e:deps"], path);
    if (deps.code !== 0) {
      return err({
        code: "unavailable",
        message: `e2e:deps가 실패했다: ${deps.stderr.trim()}`,
      });
    }
  }

  // variant가 의존을 새로 더했으면 첫 boot가 내려받느라 hello 제한을 넘긴다. trial의 core는 지금 checkout의
  // e2e deno-dir를 쓰므로 거기에 받는다.
  const currentDir = `${current}/${E2E_DENO_DIR}`;
  const filled = await io.nonEmpty(currentDir);
  const cache = await io.run(
    [Deno.execPath(), "cache", ...CORE_ENTRIES],
    path,
    filled ? { DENO_DIR: currentDir } : undefined,
  );
  if (cache.code !== 0) {
    return err({
      code: "unavailable",
      message: `core 입구 cache가 실패했다: ${cache.stderr.trim()}`,
    });
  }
  return ok(undefined);
}
