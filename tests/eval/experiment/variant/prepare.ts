import process from "node:process";

import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import type { VariantIo } from "./io.ts";

const E2E_DENO_DIR = ".dev-data/e2e/deno-dir";

// 이미 한 일이면 다시 해도 같다.
export async function prepareVariant(
  path: string,
  io: VariantIo,
): Promise<Result<void>> {
  // variant checkout이 자기 core를 띄우려면 node_modules가 그 안에 있어야 한다. workspace symlink는
  // 상대 경로라 다른 checkout 것을 빌릴 수 없다.
  const prep = await io.run(["npm", "ci", "--prefer-offline"], path);
  if (prep.code !== 0) {
    return err({
      code: "unavailable",
      message: `npm ci가 실패했다: ${prep.stderr.trim()}`,
    });
  }

  // gate의 e2e가 variant의 tests/support/app/deps.ts로 이 폴더를 읽는다. 현재 checkout 것을 symlink로 이으면
  // 앱 release 준비의 esbuild가 떨어지므로 variant가 자기 deps를 받는다.
  if (!(await io.nonEmpty(`${path}/${E2E_DENO_DIR}`))) {
    // 앱과 flow는 아직 Deno로 돌아 e2e deps만 deno task다.
    const deno = process.env["LOPHN_DENO"] ?? "deno";
    const deps = await io.run([deno, "task", "e2e:deps"], path);
    if (deps.code !== 0) {
      return err({
        code: "unavailable",
        message: `e2e:deps가 실패했다: ${deps.stderr.trim()}`,
      });
    }
  }
  return ok(undefined);
}
