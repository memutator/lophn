// 실행: node tools/ci/boot-core.ts
// 새 data root로 core를 두 번 띄운다. 두 번째는 첫 boot가 남긴 data root로 다시 뜨는 것(재시작)이다.
// 각 boot는 stdout 첫 줄(`ready`) 뒤 control stop을 보내 core가 스스로 끝나 exit 0을 내는지 본다.
// 시작 실패는 `start_failed` 값으로, 첫 줄이 오지 않은 timeout·계약 밖 줄은 던진 오류로 구별해 찍는다.
// timeout 정리는 이 도구가 띄운 pid만 대상으로 한다. OS 어디서나 도는 CI 도구다.
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  spawnCore,
  type Spawned,
  type SpawnFailed,
} from "../../tests/support/core/process.ts";

type Boot = { code: number | null; note: string };

// core가 깐 sdk 설치 사본은 읽기 전용(0555)이라 쓰기 권한을 돌려준 뒤 지운다.
async function remove(dir: string) {
  if (process.platform !== "win32") {
    await chmod(dir, 0o700);
    for (const entry of await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isDirectory())
        await chmod(join(entry.parentPath, entry.name), 0o700);
    }
  }
  await rm(dir, { recursive: true, force: true });
}

async function boot(dataRoot: string, dir: string): Promise<Boot> {
  let started: Spawned | SpawnFailed;
  try {
    started = await spawnCore(
      dataRoot,
      join(dir, "user-home"),
      join(dir, "core.log"),
    );
  } catch (error) {
    // 첫 줄이 오지 않았거나(timeout) 계약 밖이다. spawnCore가 붙인 core log 꼬리가 원인을 보인다.
    return {
      code: null,
      note: `첫 줄을 받지 못했다: ${
        error instanceof Error ? error.message : error
      }`,
    };
  }
  if (!started.ok) {
    return {
      code: started.exit,
      note: `core가 시작하지 못했다(${started.reason})`,
    };
  }
  let note = "";
  try {
    await started.stop();
  } catch (error) {
    note = `정상 종료가 실패했다: ${
      error instanceof Error ? error.message : error
    }`;
  }
  return { code: await started.exited, note };
}

const dir = await mkdtemp(join(tmpdir(), "lophn-boot-"));
const dataRoot = join(dir, "data");
await mkdir(dataRoot, { mode: 0o700 });
await mkdir(join(dir, "user-home"));
let failed = false;
try {
  for (const i of [1, 2]) {
    const { code, note } = await boot(dataRoot, dir);
    console.log(`boot ${i} exit ${code}`);
    if (code !== 0) {
      failed = true;
      console.log(note);
      break;
    }
  }
} finally {
  await remove(dir);
}
process.exit(failed ? 1 : 0);
