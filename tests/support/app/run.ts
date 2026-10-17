// app test는 core가 Unix socket을 `<home>/work/problems/tests/sock/0-b.sock`에 연다. socket 경로는 108자(SUN_LEN)
// 아래여야 하는데 `.dev-data/e2e/run-*/home` 아래는 worktree(`.claude/worktrees/<이름>/`) 안에서 그 한도를 넘는다.
// 그래서 앱 E2E의 run은 짧은 경로의 시스템 임시 폴더에 만든다. 모양은 createRun과 같다(home 0700, work, user-home).
import type { Run } from "../core/mod.ts";

// core가 깐 sdk 사본이 읽기 전용(폴더 0555)이라 폴더마다 쓰기 권한을 돌려준 뒤 지운다.
async function removeDir(dir: string): Promise<void> {
  async function open(directory: string): Promise<void> {
    await Deno.chmod(directory, 0o755);
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isDirectory) await open(`${directory}/${entry.name}`);
    }
  }
  try {
    await open(dir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  await Deno.remove(dir, { recursive: true });
}

export async function createAppRun(): Promise<Run> {
  const dir = await Deno.makeTempDir({ prefix: "lp-" });
  const home = `${dir}/home`;
  const work = `${dir}/work`;
  await Deno.mkdir(home, { mode: 0o700 });
  await Deno.mkdir(work);
  await Deno.mkdir(`${dir}/user-home`);
  return { dir, home, work, remove: () => removeDir(dir) };
}
