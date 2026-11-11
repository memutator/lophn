// 봉인된 bundle 사본이 file store와 hardlink로 나눠 쓰게 된 것을 옛 data root에 옮기는 wiring이다.
// 이미 봉인된 사본의 폴더를 잠시 열어 file을 store의 것으로 바꾸고 다시 좁힌다. 이미 이어진 file은 건너뛰어
// 도중에 꺼져 다시 돌아도 같다.
import { chmod, readdir } from "node:fs/promises";
import process from "node:process";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { bundleFileStore } from "../../../../protocol/apps/app-storage.ts";
import { isSealed, narrowTree } from "../../../apps/releases/bundle/seal.ts";
import { shareCopyFiles } from "../../../apps/releases/bundle/share.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

async function directoriesIn(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function openDirectories(directory: string): Promise<void> {
  await chmod(directory, 0o755);
  for (const name of await directoriesIn(directory)) {
    await openDirectories(`${directory}/${name}`);
  }
}

export const bundleFileSharingStep: DataStep = {
  id: "apps.bundle-file-sharing",
  async run(root): Promise<Result<void>> {
    // seal.ts의 sealCopy와 같은 이유로 Windows는 나눠 쓰지 않는다.
    if (process.platform === "win32") return ok(undefined);
    try {
      for (const app of await directoriesIn(`${root}/apps`)) {
        const folder = `${root}/apps/${app}/bundles`;
        for (const name of await directoriesIn(folder)) {
          const copy = `${folder}/${name}`;
          if (!(await isSealed(copy))) continue;
          await openDirectories(copy);
          try {
            await shareCopyFiles(copy, bundleFileStore(root));
          } finally {
            await narrowTree(copy);
          }
        }
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "the bundle copies could not share their files",
      });
    }
  },
};

export const bundleFileSharingWiring: WiringFactory = () => ({
  name: "bundle-file-sharing",
  dataSteps: [bundleFileSharingStep],
});
