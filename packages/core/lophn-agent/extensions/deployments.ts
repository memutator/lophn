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
import { globalDeployedSkillsSetting, skillsOffSetting } from "./settings.ts";

// 한 session에 닿는 배포 기록이다. 전역 설정, 그 workspace의 `extensions.json`, 그 agent 정의의 `deployed_skills`가 층이고
// MCP server(`mergeMcpLayers`)와 같은 세 자리다. 층마다 읽는 길은 읽는 쪽(turn 준비, 동기 목록, Gate)이 다르지만 합치는 규칙은 이 하나다.
// 같은 `{app, skill}`은 한 번만 두고 앱 id, skill 이름 순이다(같은 재료가 같은 bytes가 되게 한다).
// 지금 active release에 없거나 public이 아닌 skill은 여기서 가르지 않는다: 읽는 쪽이 release를 읽으며 뺀다(`appReached`).
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

// "닿는다"의 규칙은 이 둘이다: 세 층에 배포됨 ∩ active release의 public skill ∩ 그 session이 끄지 않음(전역, workspace, agent의
// `skills_off`가 이름으로 끈다. skill을 받는 규칙과 같다). Gate, 호출 판정, command 목록, 명함과 개수가 모두 이것을 쓴다.
// `off`는 세 층의 끈 이름을 합친 것이다. 앱 skill이 이름 충돌로 다른 출처의 skill에 가려지는 것은 보지 않는다(발견을 다 돌려야 안다).
export function receivedDeployments(layers: {
  global?: readonly SkillDeployment[];
  workspace?: readonly SkillDeployment[];
  agent?: readonly SkillDeployment[];
  off?: readonly string[];
}): SkillDeployment[] {
  const off = new Set(layers.off ?? []);
  return gatherDeployments(layers).filter((entry) => !off.has(entry.skill));
}

// 한 층을 읽은 것이다: 그 층의 배포 기록과 그 층이 끈 skill 이름. 읽지 못한 층은 null이다.
export type LayerRead = {
  deployed: readonly SkillDeployment[];
  off: readonly string[];
} | null;

// 한 session이 받는 배포를 세 층(전역, 그 workspace, 그 agent)에서 모으는 한 길이다. Gate, 호출 판정, command 목록이 모두 이것을 쓴다.
// 닿음은 열린 쪽으로 틀리면 안 되므로 닫는 쪽으로 판정한다(fails closed): 한 층이라도 읽지 못하면 그 층의 `skills_off`를 알 수 없어
// 다른 층의 배포가 끈 skill을 살려 낼 수 있으니, 이 session에는 받는 배포가 없다.
export function receivedFromLayers(layers: {
  global: LayerRead;
  workspace: LayerRead;
  agent: LayerRead;
}): SkillDeployment[] {
  const { global, workspace, agent } = layers;
  if (global === null || workspace === null || agent === null) return [];
  return receivedDeployments({
    global: global.deployed,
    workspace: workspace.deployed,
    agent: agent.deployed,
    off: [...global.off, ...workspace.off, ...agent.off],
  });
}

// 그 앱(id)에 닿는가: 받는 배포 가운데 그 앱의 지금 public skill이 하나라도 있다. `publicSkills`는 active release 선언의 public skill 이름이다.
export function appReached(
  received: readonly SkillDeployment[],
  app: string,
  publicSkills: readonly string[],
): boolean {
  return received.some(
    (entry) => entry.app === app && publicSkills.includes(entry.skill),
  );
}

// turn 길(machine 자격)에서 한 session이 받는 배포 기록을 읽어 합친다. 세 층을 `receivedFromLayers`로 모으므로 한 층이라도 읽지 못하면
// 받는 배포가 없다(앱을 알리지도, 묻지 않고 부르게 하지도 않는다). MCP `serversOf`가 층을 읽는 것과 같은 모양이다.
export async function deploymentsOf(
  machine: CoreCall,
  who: AgentAtWorkspace,
): Promise<SkillDeployment[]> {
  const global = await readOf(machine, settingsList, {
    keys: [globalDeployedSkillsSetting.key, skillsOffSetting.key],
  });
  const workspace = await readOf(machine, workspaceExtensionSettingsRead, {
    workspace: workspaceKeyOf(who.workspace),
  });
  const agent = await readOf(machine, agentRead, { agent: who.agent });
  const settings = global.ok
    ? createListSettingsReader(global.value.settings)
    : null;
  const definition =
    agent.ok && agent.value.issues.length === 0
      ? ((agent.value.definition as {
          deployed_skills?: readonly SkillDeployment[];
          skills_off?: readonly string[];
        } | null) ?? {})
      : null;
  return receivedFromLayers({
    global:
      settings === null
        ? null
        : {
            deployed: settings.get(globalDeployedSkillsSetting) ?? [],
            off: settings.get(skillsOffSetting) ?? [],
          },
    workspace: workspace.ok
      ? {
          deployed: workspace.value.deployed_skills,
          off: workspace.value.skills_off,
        }
      : null,
    agent:
      agent.ok && definition !== null
        ? {
            deployed: definition.deployed_skills ?? [],
            off: definition.skills_off ?? [],
          }
        : null,
  });
}
