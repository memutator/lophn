// Agent 탭(lophn session을 보이는 탭)은 더 이상 저장하지 않는다(shell의 이 창 메모리에만 산다). 이미 저장된 layout 파일
// (`shell/workspaces/*.json`, 판 10)과 전역 float 파일(`shell/global-floats.json`, 판 2)에서 Agent 탭을 걷어낸다.
// shell main은 agent kind를 schema에서 뺐으므로 그대로 두면 읽을 때마다 건너뛰어야 하고, 남은 session 참조가 파일에 쌓인다.
// - tabs·floats·detached의 `kind: "agent"` 탭을 지운다.
// - Agent 탭이 든 group은 풀고(남은 탭은 tabs에 그대로 남는다) 고른 탭이 지워졌으면 첫 보이는 탭을 고른다. artifact-move와 같은 규칙이다.
// 다른 판(손상, 옛 판)의 파일은 건드리지 않는다. 다시 돌아도 같다(Agent 탭이 없으면 아무것도 쓰지 않는다).
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAgent = (tab: unknown) => isRecord(tab) && tab["kind"] === "agent";

// group 배치 tree가 가리키는 탭 key(보이는 leaf와 칸의 stack).
function keysOf(node: unknown): string[] {
  if (!isRecord(node)) return [];
  return [
    ...(typeof node["tab"] === "string" ? [node["tab"]] : []),
    ...(Array.isArray(node["stack"])
      ? node["stack"].filter((key): key is string => typeof key === "string")
      : []),
    ...keysOf(node["a"]),
    ...keysOf(node["b"]),
  ];
}

// 칸에 가려진 탭은 고른 탭이 될 수 없다.
function hiddenOf(node: unknown): string[] {
  if (!isRecord(node)) return [];
  if (typeof node["tab"] === "string") {
    return Array.isArray(node["stack"])
      ? node["stack"].filter(
          (key): key is string =>
            typeof key === "string" && key !== node["tab"],
        )
      : [];
  }
  return [...hiddenOf(node["a"]), ...hiddenOf(node["b"])];
}

function dropFromDesk(desk: unknown): boolean {
  if (
    !isRecord(desk) ||
    !Array.isArray(desk["tabs"]) ||
    !Array.isArray(desk["floats"]) ||
    !Array.isArray(desk["detached"])
  ) {
    return false;
  }
  const tabs = desk["tabs"].filter((tab) => !isAgent(tab));
  const floats = desk["floats"].filter(
    (item) => !(isRecord(item) && isAgent(item["tab"])),
  );
  const detached = desk["detached"].filter(
    (item) => !(isRecord(item) && isAgent(item["tab"])),
  );
  if (
    tabs.length === desk["tabs"].length &&
    floats.length === desk["floats"].length &&
    detached.length === desk["detached"].length
  ) {
    return false;
  }
  const dropped = new Set(
    desk["tabs"]
      .filter(isAgent)
      .map((tab) => (isRecord(tab) ? tab["key"] : undefined)),
  );
  const groups = (Array.isArray(desk["groups"]) ? desk["groups"] : []).filter(
    (group) =>
      !(isRecord(group) ? keysOf(group["layout"]) : []).some((key) =>
        dropped.has(key),
      ),
  );
  if (dropped.has(desk["selected_tab"])) {
    const hidden = new Set(
      groups.flatMap((group) =>
        isRecord(group) ? hiddenOf(group["layout"]) : [],
      ),
    );
    const next = tabs.find(
      (tab) => isRecord(tab) && !hidden.has(tab["key"] as string),
    );
    desk["selected_tab"] = isRecord(next) ? next["key"] : null;
  }
  desk["tabs"] = tabs;
  desk["floats"] = floats;
  desk["detached"] = detached;
  desk["groups"] = groups;
  return true;
}

/** 판 10 layout 텍스트에서 Agent 탭을 걷어낸다. 바꿀 것이 없거나 판 10이 아니면 null이다. */
export function layoutTextWithoutAgentTabs(text: string): string | null {
  let layout: unknown;
  try {
    layout = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(layout) ||
    layout["schema_version"] !== 10 ||
    !isRecord(layout["desks"])
  ) {
    return null;
  }
  let changed = false;
  for (const desk of Object.values(layout["desks"])) {
    if (dropFromDesk(desk)) changed = true;
  }
  return changed ? JSON.stringify(layout) : null;
}

/** 판 2 전역 float 텍스트에서 Agent 탭의 float을 걷어낸다. 바꿀 것이 없거나 판 2가 아니면 null이다. */
export function globalFloatsTextWithoutAgentTabs(text: string): string | null {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(file) ||
    file["schema_version"] !== 2 ||
    !Array.isArray(file["floats"])
  ) {
    return null;
  }
  const floats = file["floats"].filter(
    (item) => !(isRecord(item) && isAgent(item["tab"])),
  );
  if (floats.length === file["floats"].length) return null;
  return JSON.stringify({ ...file, floats });
}

async function rewrite(
  path: string,
  convert: (text: string) => string | null,
): Promise<void> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return;
    throw thrown;
  }
  const next = convert(text);
  if (next === null) return;
  const mode = await stat(path).then((found) => found.mode & 0o777);
  await writeFile(`${path}.tmp`, next, { mode });
  await rename(`${path}.tmp`, path);
}

export const shellAgentTabsStep: DataStep = {
  id: "shell.agent-tabs-unsaved",
  async run(root): Promise<Result<void>> {
    try {
      const folder = `${root}/shell/workspaces`;
      const names = await readdir(folder).catch((thrown: unknown) => {
        if (errorCode(thrown) === "ENOENT") return [];
        throw thrown;
      });
      for (const name of names) {
        if (name.endsWith(".json")) {
          await rewrite(`${folder}/${name}`, layoutTextWithoutAgentTabs);
        }
      }
      await rewrite(
        `${root}/shell/global-floats.json`,
        globalFloatsTextWithoutAgentTabs,
      );
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "shell layout 파일에서 Agent 탭을 걷어내지 못했다",
      });
    }
  },
};

export const shellAgentTabsWiring: WiringFactory = () => ({
  name: "shell-agent-tabs",
  dataSteps: [shellAgentTabsStep],
});
