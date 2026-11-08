import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentId,
  LOPHN_HOME_ID,
} from "../../../protocol/lophn-agent/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";

// 정의 파일의 옛 `domains` 칸을 지운다. 정의 schema가 그 칸을 더 받지 않아 남아 있으면 정의를 못 읽는다.
// 파일은 schema 없이 YAML로 읽고, 지운 뒤의 새 모양만 schema로 검사해 쓴다. 칸이 없는 파일은 건드리지 않는다.
export const DROP_DOMAINS_STEP_ID = "agents.drop-domains";

const FENCE = "---";
const YAML_OPTIONS = { schema: "core" } as const;
const STRINGIFY_OPTIONS = {
  schema: "core",
  lineWidth: 0,
  aliasDuplicateObjects: false,
} as const;

export const dropDomainsFieldStep: DataStep = {
  id: DROP_DOMAINS_STEP_ID,
  async run(root): Promise<Result<void>> {
    try {
      const files = await readdir(`${root}/agents`).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
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
          Array.isArray(fields) ||
          !("domains" in fields)
        ) {
          continue;
        }
        const { domains: _domains, ...kept } = fields as Record<
          string,
          unknown
        >;
        // 옛 전역 lophn 파일(`lophn.md`)은 id가 아직 `lophn`이던 때의 것이라 같은 정의 꼴(Home lophn)로 읽는다.
        const agent = (
          file === "lophn.md" ? LOPHN_HOME_ID : file.slice(0, -3)
        ) as AgentId;
        const parsed = parseAgentFile(
          `${FENCE}\n${stringify(kept, STRINGIFY_OPTIONS)}${FENCE}\n${lines.slice(close + 1).join("\n")}`,
          { agent },
        );
        // 틀린 파일은 그대로 둔다. 사람이 고칠 일이다.
        if (!parsed.ok) continue;
        const text = serializeAgentFile(parsed.value, { agent });
        if (!text.ok) continue;
        await writeFile(`${path}.tmp`, text.value, "utf8");
        await rename(`${path}.tmp`, path);
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "the domains field could not be removed from agent files",
      });
    }
  },
};
