import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentGrant,
  type AgentGrantEntry,
  DEFAULT_REACTION_MODE,
  REACTION_EVENT_TYPES,
  type ReactionGrant,
} from "../../../protocol/approvals/mod.ts";
import type { SettingsReader } from "../../../protocol/config/mod.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Grants } from "../ports.ts";
import { withNever } from "./model.ts";
import { reactionSettings } from "./reaction-settings.ts";

// 바깥 연결 지점. 앱 grant는 apps/permissions의 읽기, agent grant는 표 읽기와 사람 자격의
// agentGrantsSet 호출이다. 이 module은 저장소와 transport를 모른다.
export interface GrantsConnections {
  appGrantsOf(app: string): Promise<Result<AppGrant[]>>;
  readAgentGrant(agent: AgentRef): Promise<Result<AgentGrant>>;
  writeAgentGrant(
    agent: AgentRef,
    entries: AgentGrantEntry[],
  ): Promise<Result<AgentGrant>>;
  settings: SettingsReader;
}

export function createGrants(connections: GrantsConnections): Grants {
  return {
    appGrants: (app) => connections.appGrantsOf(app),
    agentGrant: (agent) => connections.readAgentGrant(agent),
    reactionGrant() {
      const grant = Object.fromEntries(
        REACTION_EVENT_TYPES.map((type) => [
          type,
          connections.settings.get(reactionSettings[type]) ??
            DEFAULT_REACTION_MODE,
        ]),
      ) as ReactionGrant;
      return Promise.resolve(ok(grant));
    },
    async setAlways(agent, target) {
      const current = await connections.readAgentGrant(agent);
      if (!current.ok) return current;
      const next = withNever(current.value.entries, target);
      if (!next.ok) return next;
      const written = await connections.writeAgentGrant(agent, next.value);
      return written.ok ? ok(undefined) : err(written.error);
    },
  };
}
