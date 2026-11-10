// 색이 background·accent preset 두 축에서 모드별 theme과 accent 색 하나로 바뀌었다. `settings.json`의 옛 값을 옮긴다:
// `shell.theme`(light·dark·system)은 `shell.mode`로, `shell.background`는 같은 이름의 light·dark 내장 theme으로,
// 이름 accent는 그 preset의 light 바탕색으로(ink는 theme을 따르는 기본으로) 간다. 모르는 key나 틀린 값 하나가
// settings 전체를 거절시키므로 옛 key는 지운다.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";

// 옛 accent preset의 light ink 바탕색(packages/design의 옛 presets.ts). 옮긴 뒤에는 쓰지 않는 고정 표다.
const ACCENT_HEX: Readonly<Record<string, string>> = {
  blue: "#1d5bbf",
  green: "#1b7a3c",
  purple: "#6b3fc4",
  orange: "#b34a0c",
};
const BACKGROUNDS = new Set(["neutral", "cool"]);
const MODES = new Set(["light", "dark", "system"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 옮긴 settings. 옮길 것이 없으면 undefined다. */
export function migrateAppearanceSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const accent = settings["shell.accent"];
  const oldAccent =
    typeof accent === "string" && !accent.startsWith("#") && accent !== "theme";
  if (
    !("shell.theme" in settings) &&
    !("shell.background" in settings) &&
    !oldAccent
  ) {
    return undefined;
  }
  const next = { ...settings };
  const mode = next["shell.theme"];
  delete next["shell.theme"];
  if (typeof mode === "string" && MODES.has(mode) && !("shell.mode" in next)) {
    next["shell.mode"] = mode;
  }
  const background = next["shell.background"];
  delete next["shell.background"];
  if (typeof background === "string" && BACKGROUNDS.has(background)) {
    next["shell.light_theme"] ??= `${background}-light`;
    next["shell.dark_theme"] ??= `${background}-dark`;
  }
  if (oldAccent) {
    const hex = ACCENT_HEX[accent];
    if (hex === undefined) delete next["shell.accent"];
    else next["shell.accent"] = hex;
  }
  return next;
}

// 다시 돌아도 같다: 옛 key·값이 없으면 아무것도 쓰지 않는다.
export const appearanceThemesStep: DataStep = {
  id: "settings.appearance-themes",
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
        // 사람이 고칠 파일이다. 옮길 수 없으면 그대로 둔다.
        return ok(undefined);
      }
      if (!isRecord(settings)) return ok(undefined);
      const next = migrateAppearanceSettings(settings);
      if (next === undefined) return ok(undefined);
      const mode = (await stat(path)).mode & 0o777;
      await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, {
        mode,
      });
      await rename(`${path}.tmp`, path);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message:
          "settings.json의 옛 theme·background·accent 값을 옮기지 못했다",
      });
    }
  },
};
