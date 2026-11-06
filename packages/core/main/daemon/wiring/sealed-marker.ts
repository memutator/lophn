// 봉인 판정이 mode의 쓰기 비트에서 사본 옆 표지 file(`<사본>.sealed`)로 바뀐 것을 옛 data root에 옮기는 wiring이다.
// 옛 core가 봉인한 사본(맨 위 폴더에 쓰기 비트가 없다)에 표지를 써 준다. 안 쓰면 새 core가 봉인 안 된 사본으로 보고 지운다.
// 이미 표지가 있으면 건너뛰어 다시 돌아도 같다.
import { readdir, stat, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { sealMarkerPath } from "../../../apps/releases/bundle/seal.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

async function namesIn(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export const sealedMarkerStep: DataStep = {
  id: "apps.sealed-marker",
  async run(root): Promise<Result<void>> {
    try {
      for (const app of await namesIn(`${root}/apps`)) {
        const folder = `${root}/apps/${app}/bundles`;
        for (const name of await namesIn(folder)) {
          if (name.endsWith(".sealed")) continue;
          const copy = `${folder}/${name}`;
          const top = await stat(copy).catch(() => null);
          if (top === null || !top.isDirectory()) continue;
          if (((top.mode ?? 0) & 0o222) !== 0) continue;
          await writeFile(sealMarkerPath(copy), "");
        }
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "the seal markers of the bundle copies could not be written",
      });
    }
  },
};

export const sealedMarkerWiring: WiringFactory = () => ({
  name: "sealed-marker",
  dataSteps: [sealedMarkerStep],
});
