import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import { e2eNpmCache } from "../../../support/app/deps.ts";
import type { VariantIo } from "./io.ts";

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
  if (!(await io.nonEmpty(e2eNpmCache(path)))) {
    const deps = await io.run(["npm", "run", "e2e:deps"], path);
    if (deps.code !== 0) {
      return err({
        code: "unavailable",
        message: `e2e:deps가 실패했다: ${deps.stderr.trim()}`,
      });
    }
  }
  return ok(undefined);
}
