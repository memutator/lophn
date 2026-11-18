// 지운 앱의 browser 저장소(cookie, localStorage, IndexedDB, cache)를 비운다. 앱 view의 partition은
// `persist:app-<app>:live`와 `persist:app-<app>:preview-<hash>`, 다른 기계의 앱은 `persist:app-<app>:machine-<기계>`이고
// (session-policy.ts) 디스크의 `<userData>/Partitions/<이름>`에 놓인다. preview는 hash마다 있어 폴더 이름으로 찾는다.
// 이 컴퓨터에서 지운 앱은 이 컴퓨터의 것(live, preview)만, 다른 기계에서 지운 앱은 그 기계의 partition만 비운다: 같은 앱 id가
// 다른 기계에 남아 있을 수 있다.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { appPartition } from "./session-policy.ts";

export interface PartitionStore {
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
}

export interface AppStorageDeps {
  userData: string;
  partition(name: string): PartitionStore;
  log(message: string): void;
}

/** 디스크 폴더 이름(`app-<app>%3Apreview-<hash>` 꼴)에서 partition 이름을 푼다. 이 앱의 preview가 아니면 null이다. */
function previewOf(folder: string, app: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(folder);
  } catch {
    return null;
  }
  return name.startsWith(`app-${app}:preview-`) ? `persist:${name}` : null;
}

/** `machine`이 null이면 이 컴퓨터에서 지운 앱이고, 아니면 그 기계에서 지운 앱이다. */
export async function clearAppStorage(
  deps: AppStorageDeps,
  app: string,
  machine: string | null,
): Promise<void> {
  const root = join(deps.userData, "Partitions");
  const named = new Map<string, string>();
  // 폴더는 session을 만들 때 생기므로 이름에서 정한다(`:`는 `%3A`).
  const fixed = appPartition(app, "live", "", machine);
  named.set(fixed, encodeURIComponent(fixed.slice("persist:".length)));
  if (machine === null) {
    const folders = await readdir(root).catch(() => [] as string[]);
    for (const folder of folders) {
      const name = previewOf(folder, app);
      if (name !== null) named.set(name, folder);
    }
  }
  for (const [name, folder] of named) {
    try {
      const store = deps.partition(name);
      await store.clearStorageData();
      await store.clearCache();
      // 비운 뒤 남은 빈 폴더도 지운다. 앱이 없으니 다시 쓰는 곳이 없다.
      if (folder !== "")
        await rm(join(root, folder), { recursive: true, force: true });
    } catch (thrown) {
      deps.log(
        `앱 ${app}의 저장소를 비우지 못했다(${name}): ${String(thrown)}`,
      );
    }
  }
}
