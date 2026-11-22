import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";

// 정의의 `profile` 칸은 `avatar`가 됐다(browser profile, agent profile과 말이 겹쳤다). frontmatter 최상위의
// `profile:` 키만 고치고 값(아래 들여쓴 줄)과 나머지 bytes는 그대로 둔다. 이미지는 이미 `agents/<id>/avatar.*`라 옮길 것이 없다.
// 정의를 schema로 읽는 다른 data step보다 앞서 돌아야 해서 agent-handle wiring 안에 놓는다.
export const AGENT_AVATAR_STEP_ID = "agents.avatar";

const FENCE = "---";
const PROFILE_KEY = /^profile:/;

export const agentAvatarStep: DataStep = {
  id: AGENT_AVATAR_STEP_ID,
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
          if (!PROFILE_KEY.test(line)) continue;
          lines[i] = `avatar:${line.slice("profile:".length)}`;
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
        message: "agent profile could not be renamed to avatar",
      });
    }
  },
};
