import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  MCP_TOOL_PREFIX,
  parseExtensionToolName,
  WORKSPACE_KINDS,
  workspaceToolNames,
} from "../../../protocol/lophn-agent/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";

// custom은 `lophn` tool을 늘 받아 lophn 명령과 앱 command를 정의 `tools`에 이름으로 적지 않는다. 옛 정의의 명령 이름(`call.reply`,
// `tab.open`, `<slug>.<command>`)은 저장 검사가 거절하므로 file에서 뺀다. 내장 tool, MCP tool, extension tool 이름과 다른 칸은 그대로다.
export const AGENT_TOOLS_NO_COMMANDS_STEP_ID = "agents.tools-no-commands";

const FENCE = "---";
const YAML_OPTIONS = { schema: "core" } as const;
const STRINGIFY_OPTIONS = {
  schema: "core",
  lineWidth: 0,
  aliasDuplicateObjects: false,
} as const;
// `lophn`도 목록에 있지만 늘 받으니 고르는 이름이 아니다.
const BUILTIN = new Set(
  WORKSPACE_KINDS.flatMap(workspaceToolNames).filter(
    (name) => name !== "lophn",
  ),
);

function kept(name: unknown): boolean {
  if (typeof name !== "string") return true;
  return (
    BUILTIN.has(name) ||
    parseExtensionToolName(name) !== null ||
    (name.startsWith(MCP_TOOL_PREFIX) &&
      name.slice(MCP_TOOL_PREFIX.length).includes("__"))
  );
}

export const agentToolsNoCommandsStep: DataStep = {
  id: AGENT_TOOLS_NO_COMMANDS_STEP_ID,
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
        if (!Array.isArray(found.tools) || found.tools.every(kept)) continue;
        const tools = found.tools.filter(kept);
        const { tools: _old, ...rest } = found;
        const moved = tools.length === 0 ? rest : { ...found, tools };
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
        message: "agent tools could not be cleaned of command names",
      });
    }
  },
};
