import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";

// 옛 정의의 주소는 name이었다. 새 `handle`(주소)을 지금의 name으로 채워, name을 주소로 적은 call, workflow.yaml,
// 사람의 습관이 그대로 닿게 한다. lophn.md는 handle이 `lophn`으로 고정이라 건드리지 않는다.
// 다른 data step이 이 뒤에 정의를 schema로 읽으므로 그보다 앞에 돈다. 파일은 schema 없이 YAML로 읽고 쓴다.
export const AGENT_HANDLE_STEP_ID = "agents.handle";

const FENCE = "---";
const YAML_OPTIONS = { schema: "core" } as const;
const STRINGIFY_OPTIONS = {
  schema: "core",
  lineWidth: 0,
  aliasDuplicateObjects: false,
} as const;

export const agentHandleStep: DataStep = {
  id: AGENT_HANDLE_STEP_ID,
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
        let fields: unknown;
        try {
          fields = parse(lines.slice(1, close).join("\n"), YAML_OPTIONS);
        } catch {
          continue;
        }
        if (
          fields === null ||
          typeof fields !== "object" ||
          Array.isArray(fields)
        ) {
          continue;
        }
        const found = fields as Record<string, unknown>;
        // 틀린 파일(이름 없음)은 그대로 둔다. 사람이 고칠 일이다.
        if (
          "handle" in found ||
          typeof found.name !== "string" ||
          found.name.trim() === ""
        ) {
          continue;
        }
        const moved = { handle: found.name.trim(), ...found };
        await writeFile(
          `${path}.tmp`,
          `${FENCE}\n${stringify(moved, STRINGIFY_OPTIONS)}${FENCE}\n${lines.slice(close + 1).join("\n")}`,
          "utf8",
        );
        await rename(`${path}.tmp`, path);
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "agent handles could not be added",
      });
    }
  },
};
