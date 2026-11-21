// 탭 주인(session)의 이름과 얼굴. 탭 줄, 칸 머리, float bar, detached 창 제목, float chip이 같이 쓴다. 주인이 없는 탭은 사람의 것이라
// 아무것도 그리지 않는다. session → agent → 이름·얼굴은 창마다 아는 것이 달라(workspace 창, 전역 float 층, detached 창) 그 자리가
// provider로 준다. provider가 모르는 session은 바깥 provider에 묻고(gallery가 바깥에서 고정 값을 준다), 끝까지 모르면 "Agent"와 기본 얼굴이다.
import { t } from "@lophn/i18n";
import { createContext, type ReactNode, useContext } from "react";

import { DEFAULT_AGENT_CHARACTER } from "../../../../protocol/lophn-agent/agent-profile.ts";
import { LOPHN_AGENT_NAME } from "../../../../protocol/lophn-agent/agent-values.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { SidebarAgent } from "../../workspace/sidebar/sidebar-agent.ts";
import { type AgentFace, AgentFaceIcon } from "./agent-session.tsx";
import styles from "./owner.module.css";

export interface Owner {
  readonly name: string;
  readonly face: AgentFace;
}

/** session id → 주인. 모르면 undefined다. */
export type OwnerLookup = (session: string) => Owner | undefined;

const OwnerContext = createContext<OwnerLookup>(() => undefined);

// lophn의 기본 얼굴(core의 `LOPHN_PROFILE`과 같다).
const LOPHN_FACE: AgentFace = {
  kind: "lophn",
  profile: { kind: "character", shape: "square", color: "coral" },
};

/**
 * 창이 아는 session 목록과 agent 줄로 주인을 찾는다. agent 줄에 없는 lophn은 이름 목록(`lophnNames`)과 lophn 얼굴이고,
 * 그 밖은 모른다.
 */
export function ownerLookup(
  sessions: readonly {
    readonly session: string;
    readonly agent: string | null;
  }[],
  agents: readonly SidebarAgent[],
  lophnNames: Readonly<Record<string, string>>,
): OwnerLookup {
  return (session) => {
    const agent = sessions.find((one) => one.session === session)?.agent;
    if (agent == null) return undefined;
    const row = agents.find((one) => one.assignment === agent);
    if (row !== undefined) {
      return { name: row.name, face: { kind: "lophn", profile: row.profile } };
    }
    if (isLophn(agent)) {
      return { name: lophnNames[agent] ?? LOPHN_AGENT_NAME, face: LOPHN_FACE };
    }
    return undefined;
  };
}

export function OwnerProvider({
  lookup,
  children,
}: {
  lookup: OwnerLookup;
  children: ReactNode;
}) {
  const outer = useContext(OwnerContext);
  return (
    <OwnerContext.Provider
      value={(session) => lookup(session) ?? outer(session)}
    >
      {children}
    </OwnerContext.Provider>
  );
}

/** 주인 session → 이름과 얼굴. 목록처럼 여럿을 한 번에 찾을 때 쓴다. 모르는 session은 "Agent"와 기본 얼굴이다. */
export function useOwners(): (owner: string) => Owner {
  const lookup = useContext(OwnerContext);
  return (owner) =>
    lookup(owner) ?? {
      name: t("shell.label.owner-unknown"),
      face: { kind: "lophn", profile: DEFAULT_AGENT_CHARACTER },
    };
}

/** 탭 주인의 이름과 얼굴. 주인이 없으면(사람의 탭) null이다. */
export function useOwner(owner: string | undefined): Owner | null {
  const of = useOwners();
  return owner === undefined ? null : of(owner);
}

/** 주인 avatar 하나. `named`면 뒤에 이름이 붙는다. 이름이 안 보이면 avatar가 이름을 읽어 준다. */
export function OwnerMark({
  owner,
  named = false,
}: {
  owner: string | undefined;
  named?: boolean;
}) {
  const who = useOwner(owner);
  if (who === null) return null;
  return (
    <span
      className={styles.mark}
      data-owner={owner}
      role={named ? undefined : "img"}
      aria-label={named ? undefined : who.name}
    >
      <span className={styles.face} aria-hidden>
        <AgentFaceIcon face={who.face} vendorSize={14} />
      </span>
      {named ? <span className={styles.name}>{who.name}</span> : null}
    </span>
  );
}
