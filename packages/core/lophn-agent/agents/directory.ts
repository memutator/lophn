import type { Result } from "../../../base/mod.ts";
import type {
  AgentCard,
  AgentId,
  AgentRuntime,
  HarnessConfig,
  Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import { cardByHandle } from "./card.ts";
import {
  type AgentContext,
  handleOf,
  type Loaded,
  listAgents,
  loadAgent,
  nameOf,
  workspaceOfAgent,
} from "./inspect.ts";
import type { ReadSql } from "./ports.ts";

export type AgentInfo = {
  id: AgentId;
  // 주소다. 틀린 정의 file은 handle을 알 수 없어 id다.
  handle: string;
  // 보이는 이름이다.
  name: string;
  // 범위 workspace. 없으면 전역이다.
  workspace: Workspace | null;
  skip: boolean;
  // 정의의 runtime. 없으면 lophn이다.
  runtime: AgentRuntime;
  // 할당: 앱 slug와 permissions.deny 규칙. 사람만 쓰는 칸이다.
  apps: readonly string[];
  deny: readonly string[];
  /** harness runtime의 model·option 설정. 없거나 비면 CLI 기본이다. */
  harnessConfig?: HarnessConfig;
  // 할당한 다른 기계의 앱. id로 둔다(그 앱은 이 기계에 slug가 없다). 사람만 쓰는 칸이다.
  remoteApps: readonly RemoteAppLine[];
  // 정의의 browser profile id 그대로다(지운 profile일 수 있다). null은 기본 profile이고, 정의 file이 틀려 읽지 못하면
  // undefined다(어느 profile인지 모른다). 사람만 쓰는 칸이다.
  browserProfile: string | null | undefined;
};

export type RemoteAppLine = {
  machine: string;
  app: string;
  name: string;
  removed: readonly string[];
};

export interface AgentDirectory {
  agent(id: AgentId): AgentInfo | null;
  agents(): readonly AgentInfo[];
  // handle로 찾은 명함. 그 workspace에서 보이는 agent만이다(lophn은 그 workspace의 것). 없는 handle과 틀린 정의 file은 null이다.
  cardOf(handle: string, workspace: Workspace | null): AgentCard | null;
}

function infoOf(loaded: Loaded): AgentInfo {
  return {
    id: loaded.agent,
    handle: handleOf(loaded),
    name: nameOf(loaded),
    workspace: workspaceOfAgent(loaded),
    skip: loaded.definition?.skip === true,
    runtime: loaded.definition?.runtime ?? "lophn",
    apps: loaded.definition?.apps ?? [],
    deny: loaded.definition?.permissions?.deny ?? [],
    ...(loaded.definition?.harness_config === undefined
      ? {}
      : { harnessConfig: loaded.definition.harness_config }),
    remoteApps: loaded.definition?.remote_apps ?? [],
    browserProfile:
      loaded.definition === null
        ? undefined
        : (loaded.definition.browser_profile ?? null),
  };
}

// 정의 파일을 열어 id와 handle·이름을 푸는 조회다. 틀린 file은 알 수 없어 id가 handle이다.
export function createAgentDirectory(
  open: (sql: ReadSql) => Result<AgentContext>,
): (sql: ReadSql) => AgentDirectory {
  return (sql) => {
    const opened = open(sql);
    return {
      agent(id) {
        if (!opened.ok) return null;
        const loaded = loadAgent(opened.value, id);
        return loaded.ok && loaded.value !== null ? infoOf(loaded.value) : null;
      },
      cardOf(handle, workspace) {
        if (!opened.ok) return null;
        const card = cardByHandle(opened.value, handle, { workspace }, null);
        return card.ok ? card.value : null;
      },
      agents() {
        if (!opened.ok) return [];
        const listed = listAgents(opened.value);
        return listed.ok ? listed.value.map(infoOf) : [];
      },
    };
  };
}
