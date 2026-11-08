// [Memory]: memory 파일의 경로를 알려 준다. 자리는 core가 쓰는 곳과 같다(`workspaceMemoryFile`, `agentMemoryFile`):
// workspace memory는 그 workspace의 그릇 자리 `memory.md`(Home `<data>/home`, project `<data>/projects/<prj>`, 앱 `<data>/apps/<app>`),
// agent memory는 `<data>/agent-memory/<agt id>.md`다. 파일이 없으면 빈 buffer로 열려 사람의 첫 저장(base_hash null)이 만들고,
// 편집기의 첫 저장은 부모 폴더를 만들지 않아 폴더는 여기서 만든다.
import { dirname, join } from "node:path";

import type { MemoryApi, MemoryTarget } from "../../ipc/memory.ts";

interface MemoryOptions {
  /** 이 shell이 core에 준 data root. */
  dataRoot: string;
  /** 폴더를 만든다. */
  makeDir: (path: string) => Promise<void>;
}

export interface Memory {
  open: MemoryApi["open"];
}

export function createMemory(options: MemoryOptions): Memory {
  const pathOf = (target: MemoryTarget): string => {
    const root = options.dataRoot;
    switch (target.kind) {
      case "home":
        return join(root, "home", "memory.md");
      case "project":
        return join(root, "projects", target.workspace, "memory.md");
      case "app":
        return join(root, "apps", target.workspace, "memory.md");
      case "agent":
        return join(root, "agent-memory", `${target.agent}.md`);
    }
  };

  return {
    async open(input) {
      try {
        const path = pathOf(input.target);
        await options.makeDir(dirname(path));
        return { ok: true, value: { path } };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
