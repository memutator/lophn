// agent grant 화면의 순수한 계산. entries(계약의 AgentGrantEntry 배열)에서 대상 줄의 상태를 읽고, 줄을 바꾼 새 entries를 만든다.
// 사람이 바꾼 것만 entries에 든다: 앱 안의 tool은 tools에 든 것만 바꾼 것이고, 나머지는 효과별 기본값이다.
import {
  type AgentGrantEntry,
  agentGrantEntryKey,
  agentKey,
  type AskSetting,
  DEFAULT_ASK,
  type Effect,
  SETTINGS_EDIT_DEFAULT_ASK,
} from "../../../../../protocol/approvals/grants.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { DomainView } from "../../source.ts";
import type { GrantApp } from "../source.ts";

type AppEntry = Extract<AgentGrantEntry, { kind: "app" }>;
type ToolEntry = Extract<AgentGrantEntry, { kind: "mcp_tool" }>;
type AgentEntry = Extract<AgentGrantEntry, { kind: "agent" }>;

/**
 * agent가 일할 domain의 이름. 고른 domain(id)이 없으면 그릇의 모든 domain이고, 그릇에 없는 id는 센 것에서 뺀다.
 * tool의 domain은 이름이라 이름으로 돌려준다.
 */
export function domainNamesOf(
  chosen: readonly string[],
  container: readonly DomainView[],
): string[] {
  return container.filter((one) =>
    chosen.length === 0 || chosen.includes(one.id)
  )
    .map((one) => one.name);
}

/**
 * 붙일 수 있는 앱 목록. agent가 일할 domain(이름)의 tool은 모두, 다른 domain의 tool은 public만 남기고, 남은 tool이
 * 없는 앱은 뺀다(domain 이름은 전체에서 하나라 다른 앱이나 그릇의 domain과 겹치지 않는다). 이미 붙은 entry는 건드리지 않는다:
 * 실행 때 목록에서 빠질 뿐이다.
 */
export function appsFor(
  apps: readonly GrantApp[],
  agentDomains: readonly string[],
): GrantApp[] {
  return apps.flatMap((app) => {
    const tools = app.tools.filter((tool) =>
      tool.public || agentDomains.includes(tool.domain)
    );
    return tools.length === 0 ? [] : [{ ...app, tools }];
  });
}

/** 대상 하나에 사람이 정한 것. ask가 없으면 효과별 기본값이다. */
export interface Pick {
  readonly removed: boolean;
  readonly ask?: AskSetting;
}

export const KEPT: Pick = { removed: false };

/** 다른 agent 부르기는 read로 센다. */
export const CALL_DEFAULT_ASK: AskSetting = DEFAULT_ASK.read;
export { SETTINGS_EDIT_DEFAULT_ASK };

export const defaultAskOf = (effect: Effect): AskSetting => DEFAULT_ASK[effect];

/** 같은 대상의 entry를 새 것으로 바꾸고, 없으면 끝에 더한다. */
export function setEntry(
  entries: readonly AgentGrantEntry[],
  entry: AgentGrantEntry,
): AgentGrantEntry[] {
  const key = agentGrantEntryKey(entry);
  const found = entries.some((one) => agentGrantEntryKey(one) === key);
  return found
    ? entries.map((one) => agentGrantEntryKey(one) === key ? entry : one)
    : [...entries, entry];
}

export function dropEntries(
  entries: readonly AgentGrantEntry[],
  keep: (entry: AgentGrantEntry) => boolean,
): AgentGrantEntry[] {
  return entries.filter(keep);
}

export const appEntryOf = (
  entries: readonly AgentGrantEntry[],
  app: string,
): AppEntry | undefined =>
  entries.find((one): one is AppEntry => one.kind === "app" && one.app === app);

/** 앱 안 tool 하나의 상태. 목록에 없으면 기본값이다. */
export function appToolPick(entry: AppEntry, tool: string): Pick {
  const found = entry.tools.find((one) => one.tool === tool);
  if (found === undefined) return KEPT;
  return found.setting === "excluded"
    ? { removed: true }
    : { removed: false, ask: found.setting };
}

/** tool 하나의 상태를 바꾼 앱 entry. 기본값과 같으면 목록에서 뺀다. */
export function withAppToolPick(
  entry: AppEntry,
  tool: string,
  effect: Effect,
  pick: Pick,
): AppEntry {
  const rest = entry.tools.filter((one) => one.tool !== tool);
  if (pick.removed) {
    return { ...entry, tools: [...rest, { tool, setting: "excluded" }] };
  }
  if (pick.ask === undefined || pick.ask === defaultAskOf(effect)) {
    return { ...entry, tools: rest };
  }
  return { ...entry, tools: [...rest, { tool, setting: pick.ask }] };
}

export const toolEntryOf = (
  entries: readonly AgentGrantEntry[],
  server: string,
  tool: string,
): ToolEntry | undefined =>
  entries.find((one): one is ToolEntry =>
    one.kind === "mcp_tool" && one.server === server && one.tool === tool
  );

export const toolPick = (entry: ToolEntry | undefined): Pick =>
  entry === undefined
    ? { removed: true }
    : { removed: false, ask: entry.setting };

/** MCP tool 하나의 상태를 바꾼 entries. 뺐으면 entry를 지운다. */
export function withToolPick(
  entries: readonly AgentGrantEntry[],
  server: string,
  tool: string,
  effect: Effect,
  pick: Pick,
): AgentGrantEntry[] {
  if (pick.removed) {
    return entries.filter((one) =>
      !(one.kind === "mcp_tool" && one.server === server && one.tool === tool)
    );
  }
  const same = pick.ask === undefined || pick.ask === defaultAskOf(effect);
  return setEntry(entries, {
    kind: "mcp_tool",
    server,
    tool,
    ...(same ? {} : { setting: pick.ask }),
  });
}

export const agentEntryOf = (
  entries: readonly AgentGrantEntry[],
  agent: CallAgent,
): AgentEntry | undefined =>
  entries.find((one): one is AgentEntry =>
    one.kind === "agent" && agentKey(one.agent) === agentKey(agent)
  );

export const settingsEntryOf = (entries: readonly AgentGrantEntry[]) =>
  entries.find((one) => one.kind === "settings");

/** 설정 고치기 줄의 상태 바꾸기. 뺐으면 entry를 지운다. */
export function withSettingsPick(
  entries: readonly AgentGrantEntry[],
  defaultAsk: AskSetting,
  pick: Pick,
): AgentGrantEntry[] {
  const target = { kind: "settings" } as const;
  if (pick.removed) {
    return entries.filter((one) => one.kind !== "settings");
  }
  const same = pick.ask === undefined || pick.ask === defaultAsk;
  return setEntry(entries, same ? target : { ...target, setting: pick.ask });
}

/** agent 부르기 하나의 상태. 줄이 없으면 켜진 기본이고, excluded는 꺼진 것이다. */
export function callPick(entry: AgentEntry | undefined): Pick {
  if (entry === undefined || entry.setting === undefined) return KEPT;
  return entry.setting === "excluded"
    ? { removed: true }
    : { removed: false, ask: entry.setting };
}

/** agent 부르기 하나의 상태를 바꾼 entries. 끄면 줄을 지우지 않고 excluded로 남긴다(줄이 없으면 core는 허락한다). */
export function withCallPick(
  entries: readonly AgentGrantEntry[],
  agent: CallAgent,
  pick: Pick,
): AgentGrantEntry[] {
  const target = { kind: "agent", agent } as const;
  if (pick.removed) {
    return setEntry(entries, { ...target, setting: "excluded" });
  }
  if (pick.ask === undefined || pick.ask === CALL_DEFAULT_ASK) {
    const key = agentGrantEntryKey(target);
    return entries.filter((one) => agentGrantEntryKey(one) !== key);
  }
  return setEntry(entries, { ...target, setting: pick.ask });
}
