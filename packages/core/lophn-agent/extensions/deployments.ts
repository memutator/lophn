import { settingsList } from "../../../protocol/config/mod.ts";
import {
  type AgentAtWorkspace,
  agentRead,
  type SkillDeployment,
  workspaceExtensionSettingsRead,
  workspaceKeyOf,
} from "../../../protocol/lophn-agent/mod.ts";
import { createListSettingsReader } from "../../config/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import { globalDeployedSkillsSetting } from "./settings.ts";

// 한 session에 닿는 배포 기록이다. 전역 설정, 그 workspace의 `extensions.json`, 그 agent 정의의 `deployed_skills`가 층이고
// MCP server(`mergeMcpLayers`)와 같은 세 자리다. 층마다 읽는 길은 읽는 쪽(turn 준비, 동기 목록, Gate)이 다르지만 합치는 규칙은 이 하나다.
// 같은 `{app, skill}`은 한 번만 두고 앱 slug, skill 이름 순이다(같은 재료가 같은 bytes가 되게 한다).
// 지금 active release에 없거나 public이 아닌 skill은 여기서 가르지 않는다: 읽는 쪽이 release를 읽으며 말없이 뺀다.
export function gatherDeployments(layers: {
  global?: readonly SkillDeployment[];
  workspace?: readonly SkillDeployment[];
  agent?: readonly SkillDeployment[];
}): SkillDeployment[] {
  const found = new Map<string, SkillDeployment>();
  for (const layer of [layers.global, layers.workspace, layers.agent]) {
    for (const entry of layer ?? []) {
      found.set(`${entry.app}\0${entry.skill}`, entry);
    }
  }
  return [...found.values()].sort(
    (a, b) =>
      (a.app < b.app ? -1 : a.app > b.app ? 1 : 0) ||
      (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0),
  );
}

// 그 앱(slug)의 skill이 하나라도 닿는가. 호출 판정과 앱 command 목록이 쓴다.
export function deploymentsReach(
  deployed: readonly SkillDeployment[],
  slug: string,
): boolean {
  return deployed.some((entry) => entry.app === slug);
}

// turn 길(machine 자격)에서 한 session에 닿는 배포 기록을 읽어 합친다. 층을 읽지 못하면 그 층이 없는 것이다: 읽지 못한 배포는 앱을 알리지도,
// 묻지 않고 부르게 하지도 않는다(fails closed). MCP `serversOf`가 층을 읽는 것과 같은 모양이다.
export async function deploymentsOf(
  machine: CoreCall,
  who: AgentAtWorkspace,
): Promise<SkillDeployment[]> {
  const global = await readOf(machine, settingsList, {
    keys: [globalDeployedSkillsSetting.key],
  });
  const workspace = await readOf(machine, workspaceExtensionSettingsRead, {
    workspace: workspaceKeyOf(who.workspace),
  });
  const agent = await readOf(machine, agentRead, { agent: who.agent });
  return gatherDeployments({
    ...(global.ok
      ? {
          global:
            createListSettingsReader(global.value.settings).get(
              globalDeployedSkillsSetting,
            ) ?? [],
        }
      : {}),
    ...(workspace.ok ? { workspace: workspace.value.deployed_skills } : {}),
    ...(agent.ok && agent.value.issues.length === 0
      ? {
          agent:
            (
              agent.value.definition as {
                deployed_skills?: readonly SkillDeployment[];
              } | null
            )?.deployed_skills ?? [],
        }
      : {}),
  });
}
