// 봉인된 bundle 사본이 file store와 hardlink로 나눠 쓰게 된 것을 옛 data root에 옮기는 wiring이다.
// 이미 봉인된 사본의 폴더를 잠시 열어 file을 store의 것으로 바꾸고 다시 좁힌다. 이미 이어진 file은 건너뛰어
// 도중에 꺼져 다시 돌아도 같다.
import { chmod, readdir } from "node:fs/promises";
import process from "node:process";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { bundleFileStore } from "../../../../protocol/apps/app-storage.ts";
import { isSealed, narrowTree } from "../../../apps/releases/bundle/seal.ts";
import {
  shareCopyFiles,
  sweepBundleFiles,
} from "../../../apps/releases/bundle/share.ts";
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

async function shareSealedCopies(root: string): Promise<Result<void>> {
  const store = bundleFileStore(root);
  try {
    for (const app of await directoriesIn(`${root}/apps`)) {
      const folder = `${root}/apps/${app}/bundles`;
      for (const name of await directoriesIn(folder)) {
        const copy = `${folder}/${name}`;
        if (!(await isSealed(copy))) continue;
        await openDirectories(copy);
        try {
          await shareCopyFiles(copy, store);
        } finally {
          await narrowTree(copy);
        }
      }
    }
    await sweepBundleFiles(store);
    return ok(undefined);
  } catch {
    return err({
      code: "unavailable",
      message: "the bundle copies could not share their files",
    });
  }
}

// 처음에는 Windows를 빼고 냈다. 그 판을 거친 Windows data root는 이 step을 적용한 것으로 적어 두었으므로
// Windows는 아래 step이 따로 옮긴다.
export const bundleFileSharingStep: DataStep = {
  id: "apps.bundle-file-sharing",
  async run(root): Promise<Result<void>> {
    if (process.platform === "win32") return ok(undefined);
    return await shareSealedCopies(root);
  },
};

export const bundleFileSharingWindowsStep: DataStep = {
  id: "apps.bundle-file-sharing-win32",
  async run(root): Promise<Result<void>> {
    if (process.platform !== "win32") return ok(undefined);
    return await shareSealedCopies(root);
  },
};

export const bundleFileSharingWiring: WiringFactory = () => ({
  name: "bundle-file-sharing",
  dataSteps: [bundleFileSharingStep, bundleFileSharingWindowsStep],
});
