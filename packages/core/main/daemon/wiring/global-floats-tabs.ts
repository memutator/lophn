// 전역 float 파일(`shell/global-floats.json`)을 판 1(앱 panel 화면만, `{app, screen, ...}`)에서 판 2(어느 kind의 탭이든
// `{workspace, tab, ...}`)로 옮긴다. 판 1의 float은 모두 앱 panel이고 workspace가 없어 Home으로 옮긴다.
// 판 1이 아닌 파일(없음, 손상, 이미 판 2)은 건드리지 않는다. 다시 돌아도 같다.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 판 1의 key 규칙과 같다(`global:<app>:<screen>`). 렌더러가 앱 panel float을 이 key로 찾는다.
const keyOf = (app: unknown, screen: unknown) => `global:${app}:${screen}`;

/** 판 1 텍스트를 판 2로 바꾼다. 판 1이 아니면 null이다. */
export function globalFloatsTextOf(text: string): string | null {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(file) ||
    file["schema_version"] !== 1 ||
    !Array.isArray(file["floats"])
  ) {
    return null;
  }
  const floats = file["floats"].flatMap((item) => {
    if (!isRecord(item)) return [];
    const { app, screen, rect, minimized, pinned } = item;
    return [
      {
        workspace: { kind: "home" },
        tab: {
          kind: "app_panel",
          key: keyOf(app, screen),
          app,
          surface: screen,
        },
        rect,
        minimized,
        ...(pinned === true ? { pinned: true } : {}),
      },
    ];
  });
  return JSON.stringify({ schema_version: 2, floats });
}

export const globalFloatsTabsStep: DataStep = {
  id: "shell.global-floats-tabs",
  async run(root): Promise<Result<void>> {
    const path = `${root}/shell/global-floats.json`;
    try {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (thrown) {
        if (errorCode(thrown) === "ENOENT") return ok(undefined);
        throw thrown;
      }
      const next = globalFloatsTextOf(text);
      if (next === null) return ok(undefined);
      const mode = await stat(path).then((found) => found.mode & 0o777);
      await writeFile(`${path}.tmp`, next, { mode });
      await rename(`${path}.tmp`, path);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "전역 float 파일을 탭 모양(판 2)으로 옮기지 못했다",
      });
    }
  },
};

export const globalFloatsTabsWiring: WiringFactory = () => ({
  name: "global-floats-tabs",
  dataSteps: [globalFloatsTabsStep],
});
