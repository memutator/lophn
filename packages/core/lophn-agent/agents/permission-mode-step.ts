import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";

// agent 정의 파일의 frontmatter `skip` 칸을 `permission_mode`로 옮긴다:
// - `skip: true` -> `permission_mode: full` (이미 `permission_mode`가 있으면 `skip` 줄만 지운다)
// - `skip: false` -> 칸을 지워 전역 기본 단계(`approvals.default_mode`)를 따르게 한다.
// 멱등하다: 이미 옮겨진 파일은 건드리지 않는다.
export const AGENT_PERMISSION_MODE_STEP_ID = "agents.permission-mode";

const FENCE = "---";
const SKIP_TRUE = /^skip:[ \t]*true[ \t]*(\r?)$/;
const SKIP_FALSE = /^skip:[ \t]*false[ \t]*(\r?)$/;
const HAS_PERMISSION_MODE = /^permission_mode:/;

export const agentPermissionModeStep: DataStep = {
  id: AGENT_PERMISSION_MODE_STEP_ID,
  async run(root): Promise<Result<void>> {
    try {
      const files = await readdir(`${root}/agents`).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const path = `${root}/agents/${file}`;
        const original = await readFile(path, "utf8");
        const lines = original.split("\n");
        const close = lines.findIndex(
          (line, i) => i > 0 && line.replace(/\r$/, "") === FENCE,
        );
        if (lines[0]?.replace(/\r$/, "") !== FENCE || close === -1) continue;
        const fmLines = lines.slice(1, close);
        const alreadyHasMode = fmLines.some((line) =>
          HAS_PERMISSION_MODE.test(line),
        );
        let changed = false;
        const nextFm: string[] = [];
        for (const line of fmLines) {
          const trueMatch = SKIP_TRUE.exec(line);
          if (trueMatch !== null) {
            changed = true;
            if (!alreadyHasMode) {
              nextFm.push(`permission_mode: full${trueMatch[1]}`);
            }
            continue;
          }
          if (SKIP_FALSE.test(line)) {
            changed = true;
            continue;
          }
          nextFm.push(line);
        }
        if (!changed) continue;
        const bodyLines = lines.slice(close + 1);
        let updated: string;
        if (nextFm.every((line) => line.trim() === "")) {
          // frontmatter가 비었으면 울타리와 뒤쪽 빈 줄 하나를 함께 걷어 낸다.
          while (bodyLines.length > 0 && bodyLines[0]?.trim() === "") {
            bodyLines.shift();
          }
          updated = bodyLines.join("\n");
        } else {
          updated = [lines[0], ...nextFm, lines[close], ...bodyLines].join(
            "\n",
          );
        }
        await writeFile(`${path}.tmp`, updated, "utf8");
        await rename(`${path}.tmp`, path);
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "agent permission_mode could not be migrated",
      });
    }
  },
};
