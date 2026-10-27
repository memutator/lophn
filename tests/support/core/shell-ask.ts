// 제품 기본 ask 규칙 `rm -r*`에 걸리는 명령이라 attended turn에서 늘 묻고, 미리 만든 폴더라 실행 여부가 disk에 남는다.
import { mkdir, stat } from "node:fs/promises";
import { errorCode } from "../../../packages/base/mod.ts";
import type { Reply } from "../fake-server/mod.ts";

export type ShellAsk = {
  dir: string; // 미리 만든 폴더의 절대 path
  command: string; // `rm -r <name>`. place 첫 폴더 기준 상대 path
  reply(id: string): Reply; // fake 대답: `shell_run {command}` tool call 하나
  exists(): Promise<boolean>; // 폴더가 아직 있나
};

// folder는 place의 첫 폴더(PM이면 project 폴더). 같은 이름으로 다시 부르면 지운 폴더를 되살린다.
export async function shellAsk(
  folder: string,
  name = "victim",
): Promise<ShellAsk> {
  const dir = `${folder}/${name}`;
  await mkdir(dir, { recursive: true });
  const command = `rm -r ${name}`;
  return {
    dir,
    command,
    reply: (id) => ({
      kind: "tool",
      calls: [{
        id,
        name: "shell_run",
        arguments: JSON.stringify({ command }),
      }],
    }),
    exists: async () => {
      try {
        await stat(dir);
        return true;
      } catch (error) {
        if (errorCode(error) === "ENOENT") return false;
        throw error;
      }
    },
  };
}
