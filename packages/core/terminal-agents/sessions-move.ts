// 저장한 coding agent session의 자리를 shell에서 주인 module의 자리로 옮기는 data step이다(`<data root>/shell/agent-sessions/*.json`
// → `<data root>/terminal-agents/sessions/`). 사람의 data root에서 도므로 내용과 mode를 그대로 두고, 새 자리에 이미 있는 file은
// 건드리지 않으며(옛 file은 버린다), 다시 돌아도 같다. 옛 폴더는 다 옮긴 뒤에만 지운다.
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../base/mod.ts";
import { sessionsFolder } from "./session-store.ts";

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

async function moveOne(from: string, to: string): Promise<void> {
  if (await exists(to)) {
    await rm(from, { force: true });
    return;
  }
  try {
    await rename(from, to);
  } catch (thrown) {
    // 다른 file system이면 rename이 안 된다. 복사한 뒤 mode를 맞추고 옛 것을 지운다.
    if ((thrown as NodeJS.ErrnoException).code !== "EXDEV") throw thrown;
    const { mode } = await lstat(from);
    await copyFile(from, to);
    await chmod(to, mode & 0o777);
    await rm(from, { force: true });
  }
}

export async function moveSavedSessions(root: string): Promise<Result<void>> {
  const old = join(root, "shell", "agent-sessions");
  let names: string[];
  try {
    names = await readdir(old);
  } catch {
    return ok(undefined);
  }
  try {
    const target = sessionsFolder(root);
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const name of names) {
      if (name.endsWith(".json"))
        await moveOne(join(old, name), join(target, name));
    }
    // 남은 것은 shell이 쓰다 남긴 temp file뿐이다. step은 한 번만 돌므로 옛 폴더를 여기서 거둔다.
    await rm(old, { recursive: true, force: true });
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: `saved coding agent sessions could not move: ${String(thrown)}`,
    });
  }
  return ok(undefined);
}
