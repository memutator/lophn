import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";

// runtime 값 `bare`의 새 이름은 `custom`이다. 정의 파일의 frontmatter `runtime: bare` 한 줄만 고치고 나머지 bytes는 그대로 둔다.
// 정의를 schema로 읽는 다른 data step보다 앞서 돌아야 해서 agents.handle 바로 뒤에 놓는다.
export const AGENT_RUNTIME_CUSTOM_STEP_ID = "agents.runtime-custom";

const FENCE = "---";
const RUNTIME_BARE = /^runtime:[ \t]*(["']?)bare\1[ \t]*(\r?)$/;

export const agentRuntimeCustomStep: DataStep = {
  id: AGENT_RUNTIME_CUSTOM_STEP_ID,
  async run(root): Promise<Result<void>> {
    try {
      const files = await readdir(`${root}/agents`).catch(() => []);
      for (const file of files) {
        if (!/^agt_.+\.md$/.test(file)) continue;
        const path = `${root}/agents/${file}`;
        const lines = (await readFile(path, "utf8")).split("\n");
        const close = lines.findIndex(
          (line, i) => i > 0 && line.replace(/\r$/, "") === FENCE,
        );
        if (lines[0]?.replace(/\r$/, "") !== FENCE || close === -1) continue;
        let changed = false;
        for (let i = 1; i < close; i++) {
          const line = lines[i] as string;
          const found = RUNTIME_BARE.exec(line);
          if (found === null) continue;
          lines[i] = `runtime: custom${found[2]}`;
          changed = true;
        }
        if (!changed) continue;
        await writeFile(`${path}.tmp`, lines.join("\n"), "utf8");
        await rename(`${path}.tmp`, path);
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "agent runtime could not be renamed to custom",
      });
    }
  },
};
