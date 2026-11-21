import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";

// System Extension 제거로 agent 정의의 옛 `extensions` 칸을 치운다.
export const DROP_EXTENSIONS_STEP_ID = "agents.drop-extensions";

const FENCE = "---";
const YAML_OPTIONS = { schema: "core" } as const;
const STRINGIFY_OPTIONS = {
  schema: "core",
  lineWidth: 0,
  aliasDuplicateObjects: false,
} as const;

type Plain = Record<string, unknown>;

function split(text: string): { fields: Plain; body: string } | null {
  const lines = text.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== FENCE) return null;
  const close = lines.findIndex(
    (line, i) => i > 0 && line.replace(/\r$/, "") === FENCE,
  );
  if (close === -1) return null;
  try {
    const fields = parse(lines.slice(1, close).join("\n"), YAML_OPTIONS);
    if (
      fields === null ||
      typeof fields !== "object" ||
      Array.isArray(fields)
    ) {
      return null;
    }
    return { fields: fields as Plain, body: lines.slice(close + 1).join("\n") };
  } catch {
    return null;
  }
}

async function folderNames(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export const dropExtensionsStep: DataStep = {
  id: DROP_EXTENSIONS_STEP_ID,
  async run(root): Promise<Result<void>> {
    try {
      for (const file of await folderNames(`${root}/agents`)) {
        if (!file.endsWith(".md")) continue;
        const path = `${root}/agents/${file}`;
        const agent = file.slice(0, -3) as AgentId;
        const found = split(await readFile(path, "utf8"));
        if (found === null || !("extensions" in found.fields)) continue;
        const { extensions: _dropped, ...rest } = found.fields;
        const parsed = parseAgentFile(
          `${FENCE}\n${stringify(rest, STRINGIFY_OPTIONS)}${FENCE}\n${found.body}`,
          { agent },
        );
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
        message: "legacy agent extensions field could not be removed",
      });
    }
  },
};
