// `claude gui` 같은 subcommand 문법이 `--gui` flag로 바뀌면서 `settings.json`의 `shell.coding_agents.commands`에
// 저장된 옛 `<cmd> gui ...`를 `<cmd> --gui ...`로 옮긴다.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";

const GUI_SUBCOMMAND = /^(claude|codex|opencode|omp|agy)\s+gui(?=$|\s)/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function migrateCodingGuiCommand(command: string): string {
  const trimmed = command.trim();
  const match = GUI_SUBCOMMAND.exec(trimmed);
  if (match === null) return command;
  return `${match[1]} --gui${trimmed.slice(match[0].length)}`;
}

export const codingGuiFlagStep: DataStep = {
  id: "settings.coding-gui-flag",
  async run(root): Promise<Result<void>> {
    const path = `${root}/settings.json`;
    try {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (thrown) {
        if (errorCode(thrown) === "ENOENT") return ok(undefined);
        throw thrown;
      }
      let settings: unknown;
      try {
        settings = JSON.parse(text);
      } catch {
        return ok(undefined);
      }
      if (!isRecord(settings)) return ok(undefined);
      const coding = settings["shell.coding_agents"];
      if (!isRecord(coding) || !isRecord(coding.commands)) {
        return ok(undefined);
      }
      let changed = false;
      const nextCommands: Record<string, unknown> = { ...coding.commands };
      for (const [id, value] of Object.entries(coding.commands)) {
        if (typeof value !== "string") continue;
        const migrated = migrateCodingGuiCommand(value);
        if (migrated !== value) {
          nextCommands[id] = migrated;
          changed = true;
        }
      }
      if (!changed) return ok(undefined);
      const next = {
        ...settings,
        "shell.coding_agents": { ...coding, commands: nextCommands },
      };
      const mode = (await stat(path)).mode & 0o777;
      await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, {
        mode,
      });
      await rename(`${path}.tmp`, path);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "settings.json의 coding agent gui 명령을 옮기지 못했다",
      });
    }
  },
};
