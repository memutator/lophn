// node-pty의 macOS prebuild는 PTY를 여는 실행 file `spawn-helper`를 같이 싣는다. platform/의 `npm ci --ignore-scripts`로 푼
// 것은 실행 권한이 없을 수 있고, 그러면 설치본의 core가 터미널마다 `spawn_failed`를 낸다.
import { chmod, readdir } from "node:fs/promises";
import { join } from "node:path";

/** `node-pty/prebuilds/darwin-*` 폴더마다 `spawn-helper`의 mode를 0755로 하고 고친 path를 돌려준다. */
export async function markSpawnHelpers(nodeModules: string): Promise<string[]> {
  const prebuilds = join(nodeModules, "node-pty", "prebuilds");
  const marked: string[] = [];
  for (const entry of await readdir(prebuilds, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("darwin-")) continue;
    const helper = join(prebuilds, entry.name, "spawn-helper");
    await chmod(helper, 0o755);
    marked.push(helper);
  }
  return marked;
}
