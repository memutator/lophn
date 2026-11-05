// place를 workspace로 부르게 되면서 data root 파일에 남은 옛 이름을 옮기는 wiring이다. ledger의 열과 JSON은
// 각 module의 schema step이 옮기고, 여기는 ledger 밖 파일만 맡는다:
// - `settings.json`의 call 정책 `places`를 `workspaces`로 옮긴다. 틀린 key 하나가 settings 전체를 거절시킨다.
// - `shell/places/<workspace>.json`을 `shell/workspaces/`로 옮기고 판 9의 agent 탭 `work_place`를 `workspace`로
//   바꿔 판 10으로 쓴다. 옮길 자리에 이미 파일이 있으면 덮지 않고 옛 파일을 남긴다.
// - workflow 폴더의 `workflow.yaml` 참가자와 `flow.ts`의 agent 주소에서 `place`를 `workspace`로 바꾼다. 선언은 모르는
//   칸을 버려 옛 key가 조용히 instance의 project로 가고, flow wire는 옛 key를 거절한다.
// artifact-move가 `shell/places`의 판 8을 판 9로 옮긴 뒤에 돌아야 해서 assembly.ts의 WIRINGS에서 그보다 뒤다.
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { isMap, isScalar, parseDocument } from "yaml";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import { CALL_POLICY_SETTING_KEY } from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_FLOW_FILE,
  workflowsFolder,
} from "../../../../protocol/workflows/paths.ts";
import { projectIdOfFolder } from "../../../agent-workspaces/workspace/data-folder.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return null;
    throw thrown;
  }
}

async function namesIn(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return [];
    throw thrown;
  }
}

const exists = (path: string) =>
  lstat(path)
    .then(() => true)
    .catch(() => false);

// 고치는 파일은 원래 mode를 지킨다. 새 파일은 shell과 settings처럼 0600이다.
async function writeAtomic(path: string, text: string): Promise<void> {
  const mode = await stat(path)
    .then((found) => found.mode & 0o777)
    .catch(() => 0o600);
  await writeFile(`${path}.tmp`, text, { mode });
  await rename(`${path}.tmp`, path);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 다시 돌아도 같다: `places`가 없으면 아무것도 쓰지 않는다.
export const callPolicyWorkspacesStep: DataStep = {
  id: "settings.call-policy-workspaces",
  async run(root): Promise<Result<void>> {
    const path = `${root}/settings.json`;
    try {
      const text = await readText(path);
      if (text === null || text.trim() === "") return ok(undefined);
      let settings: unknown;
      try {
        settings = JSON.parse(text);
      } catch {
        // 사람이 고칠 파일이다. 옮길 수 없으면 그대로 둔다.
        return ok(undefined);
      }
      if (!isRecord(settings)) return ok(undefined);
      const policy = settings[CALL_POLICY_SETTING_KEY];
      if (!isRecord(policy) || !("places" in policy)) return ok(undefined);
      if ("workspaces" in policy) return ok(undefined);
      const { places, ...rest } = policy;
      settings[CALL_POLICY_SETTING_KEY] = { workspaces: places, ...rest };
      await writeAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "settings.json의 call 정책을 workspace 이름으로 옮기지 못했다",
      });
    }
  },
};

// agent 탭만 `work_place`를 가진다. 탭이 desk의 tabs·floats·detached 어디에 있든 같다.
function renameAgentTabs(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) renameAgentTabs(item);
    return;
  }
  if (!isRecord(value)) return;
  if (value["kind"] === "agent" && "work_place" in value) {
    value["workspace"] = value["work_place"];
    delete value["work_place"];
  }
  for (const item of Object.values(value)) renameAgentTabs(item);
}

// 판 9가 아닌 파일(손상, 다른 판)은 내용을 고치지 않고 자리만 옮긴다. 읽는 쪽이 지금처럼 거절한다.
export function layoutTextOf(text: string): string {
  let layout: unknown;
  try {
    layout = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isRecord(layout) || layout["schema_version"] !== 9) return text;
  renameAgentTabs(layout);
  layout["schema_version"] = 10;
  return JSON.stringify(layout);
}

// 새 자리에 먼저 쓰고 옛 파일을 지운다. 끊겨 다시 돌면 이미 쓴 파일은 덮지 않는다.
export const workspaceLayoutsStep: DataStep = {
  id: "shell.workspace-layouts",
  async run(root): Promise<Result<void>> {
    const from = `${root}/shell/places`;
    const to = `${root}/shell/workspaces`;
    try {
      const names = (await namesIn(from)).filter((name) =>
        name.endsWith(".json"),
      );
      if (names.length > 0) await mkdir(to, { recursive: true, mode: 0o700 });
      for (const name of names) {
        if (await exists(`${to}/${name}`)) continue;
        const text = await readText(`${from}/${name}`);
        if (text === null) continue;
        await writeAtomic(`${to}/${name}`, layoutTextOf(text));
        await rm(`${from}/${name}`);
      }
      await rmdir(from).catch(() => {});
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "shell layout 파일을 workspace 자리로 옮기지 못했다",
      });
    }
  },
};

// 참가자 map의 `place` key 글자만 바꾼다. 주석, 따옴표, 줄 모양은 그대로다.
export function declarationTextOf(text: string): string {
  const doc = parseDocument(text);
  const participants = doc.get("participants", true);
  if (!isMap(participants)) return text;
  const ranges: [number, number][] = [];
  for (const pair of participants.items) {
    if (!isMap(pair.value)) continue;
    for (const inner of pair.value.items) {
      if (isScalar(inner.key) && inner.key.value === "place") {
        const range = inner.key.range;
        if (range) ranges.push([range[0], range[1]]);
      }
    }
  }
  let out = text;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
    out =
      out.slice(0, start) +
      out.slice(start, end).replace("place", "workspace") +
      out.slice(end);
  }
  return out;
}

// flow SDK의 agent 주소 `place: { project | app: … }`만 바꾼다. 다른 `place` 이름은 건드리지 않는다.
const FLOW_ADDRESS =
  /(["']?)\bplace\1(\s*:\s*\{\s*["']?(?:project|app)["']?\s*:)/g;
export function flowTextOf(text: string): string {
  return text.replace(FLOW_ADDRESS, "$1workspace$1$2");
}

export const workflowWorkspaceStep: DataStep = {
  id: "workflows.participant-workspace",
  async run(root): Promise<Result<void>> {
    try {
      for (const folder of await namesIn(`${root}/projects`)) {
        const project = projectIdOfFolder(folder);
        if (project === null) continue;
        const workflows = workflowsFolder(root, project);
        for (const name of await namesIn(workflows)) {
          for (const [file, rewrite] of [
            [WORKFLOW_DECLARATION_FILE, declarationTextOf],
            [WORKFLOW_FLOW_FILE, flowTextOf],
          ] as const) {
            const path = `${workflows}/${name}/${file}`;
            const text = await readText(path);
            if (text === null) continue;
            const next = rewrite(text);
            if (next !== text) await writeAtomic(path, next);
          }
        }
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "workflow 파일의 place를 workspace로 옮기지 못했다",
      });
    }
  },
};

export const workspaceRenameWiring: WiringFactory = () => ({
  name: "workspace-rename",
  dataSteps: [
    callPolicyWorkspacesStep,
    workspaceLayoutsStep,
    workflowWorkspaceStep,
  ],
});
