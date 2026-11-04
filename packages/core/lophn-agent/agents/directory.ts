import type { Result } from "../../../base/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/mod.ts";
import {
  type AgentContext,
  listAgents,
  loadAgent,
  type Loaded,
  nameOf,
} from "./inspect.ts";
import type { ReadSql } from "./ports.ts";

export type AgentInfo = {
  id: AgentId;
  name: string;
  skip: boolean;
  // 할당: 앱 slug와 permissions.deny 규칙. 사람만 쓰는 칸이다.
  apps: readonly string[];
  deny: readonly string[];
};

export interface AgentDirectory {
  agent(id: AgentId): AgentInfo | null;
  agents(): readonly AgentInfo[];
}

function infoOf(loaded: Loaded): AgentInfo {
  return {
    id: loaded.agent,
    name: nameOf(loaded),
    skip: loaded.definition?.skip === true,
    apps: loaded.definition?.apps ?? [],
    deny: loaded.definition?.permissions?.deny ?? [],
  };
}

// 정의 파일을 열어 id와 이름을 푸는 조회다. 틀린 file은 이름을 알 수 없어 id가 이름이다.
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
      agents() {
        if (!opened.ok) return [];
        const listed = listAgents(opened.value);
        return listed.ok ? listed.value.map(infoOf) : [];
      },
    };
  };
}
