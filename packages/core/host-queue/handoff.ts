import { mkdir, writeFile } from "node:fs/promises";
import type { Id } from "../../protocol/base/ids.ts";

// coding agent TUI에 넘기는 handoff 글의 file이다. 글은 터미널에 치지 않고 이 file의 경로만 첫 prompt에 들어간다.
export type HandoffFiles = {
  // `<data root>/handoffs/<tab>.md`에 쓰고 그 경로를 돌려준다.
  write(tab: Id<"tab">, text: string): Promise<string>;
};

export function fileHandoffs(dataRoot: string): HandoffFiles {
  return {
    async write(tab, text) {
      const dir = `${dataRoot}/handoffs`;
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = `${dir}/${tab}.md`;
      await writeFile(file, text, { mode: 0o600 });
      return file;
    },
  };
}
