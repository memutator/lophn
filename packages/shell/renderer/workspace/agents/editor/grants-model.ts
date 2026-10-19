// agent grant 화면의 순수한 계산. entries(계약의 AgentGrantEntry 배열)에서 대상 줄의 상태를 읽고, 줄을 바꾼 새 entries를 만든다.
// 사람이 바꾼 것만 entries에 든다: 앱 안의 app-api는 apis에 든 것만 바꾼 것이고, 나머지는 효과별 기본값이다.
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
import type { GrantApp } from "../source.ts";

type AppEntry = Extract<AgentGrantEntry, { kind: "app" }>;
type ToolEntry = Extract<AgentGrantEntry, { kind: "mcp_tool" }>;
type AgentEntry = Extract<AgentGrantEntry, { kind: "agent" }>;

/**
 * 붙일 수 있는 앱 목록. 다른 project의 앱은 public tool만 남기고, 남은 tool이 없는 앱은 뺀다(place가 null인
 * lophn은 모든 앱이 다른 project다). 이미 붙은 entry는 건드리지 않는다: 실행 때 목록에서 빠질 뿐이다.
 */
export function appsFor(
  apps: readonly GrantApp[],
  place: string | null,
): GrantApp[] {
  return apps.flatMap((app) => {
    if (app.project === place) return [app];
    const apis = app.apis.filter((api) => api.public);
    return apis.length === 0 ? [] : [{ ...app, apis }];
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

/** 앱 안 app-api 하나의 상태. 목록에 없으면 기본값이다. */
export function apiPick(entry: AppEntry, api: string): Pick {
  const found = entry.apis.find((one) => one.api === api);
  if (found === undefined) return KEPT;
  return found.setting === "excluded"
    ? { removed: true }
    : { removed: false, ask: found.setting };
}

/** app-api 하나의 상태를 바꾼 앱 entry. 기본값과 같으면 목록에서 뺀다. */
export function withApiPick(
  entry: AppEntry,
  api: string,
  effect: Effect,
  pick: Pick,
): AppEntry {
  const rest = entry.apis.filter((one) => one.api !== api);
  if (pick.removed) {
    return { ...entry, apis: [...rest, { api, setting: "excluded" }] };
  }
  if (pick.ask === undefined || pick.ask === defaultAskOf(effect)) {
    return { ...entry, apis: rest };
  }
  return { ...entry, apis: [...rest, { api, setting: pick.ask }] };
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
