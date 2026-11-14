// phone의 대화 자리. desktop Agent 탭과 같은 `AgentView`를 phone host로 그린다. phone에 없는 화면(권한 편집, Settings ›
// Agents, 파일, 터미널, artifact)으로 가는 host member는 주지 않아 그 항목이 빠진다. 다른 session(fork, call을 받은 쪽,
// 첫 말로 만든 새 session)은 틀의 대화로 옮겨 간다.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import { commonIcons } from "../../icons/common.ts";
import { coreAgentTabSourceFactory } from "../../conversation/agent-tab-core-source.ts";
import {
  AgentView,
  type AgentViewHost,
} from "../../conversation/agent-view.tsx";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import { DraftStore } from "../../conversation/drafts.ts";
import { useEventClient } from "../../desktop/connection/events/hooks.tsx";
import type { RemoteChatProps } from "../remote-app.tsx";
import styles from "./remote-chat.module.css";

/**
 * 대화 component를 만든다. 쓰던 글과 보내는 중인 말은 대화를 오가도 남아야 해서(첫 말이 만든 session으로 옮겨 가는 동안에도)
 * 화면 하나에 draft 하나를 이 closure가 쥔다. `sources`가 없으면 틀의 core 통로로 읽는다(gallery는 fake를 준다).
 */
export function remoteChat(
  sources?: AgentTabSourceFactory,
): (props: RemoteChatProps) => ReactNode {
  const drafts = new DraftStore();
  return (props) => <RemoteChat {...props} drafts={drafts} sources={sources} />;
}

function RemoteChat({
  session: opened,
  agent,
  workspace,
  onOpenSession,
  onBack,
  drafts,
  sources,
}: RemoteChatProps & {
  drafts: DraftStore;
  sources: AgentTabSourceFactory | undefined;
}) {
  const { core } = useEventClient();
  const factory = useMemo(
    () => sources ?? coreAgentTabSourceFactory(core),
    [sources, core],
  );
  const source = useMemo(
    () =>
      agent === null
        ? null
        : factory({
            assignment: agent,
            workspace: workspace ?? { kind: "global", id: "" },
          }),
    [factory, agent, workspace?.kind, workspace?.id],
  );
  // null은 이 agent의 새 session(`/new`, 보던 session이 사라짐)이다. 첫 말이 session을 만들면 틀이 그 대화로 옮겨 간다.
  const [session, setSession] = useState<string | null>(opened);
  const host: AgentViewHost = {
    openForked: onOpenSession,
    openSession: onOpenSession,
  };
  const bottom = useKeyboardInset();
  if (source === null) return null;
  return (
    <div
      className={styles.chat}
      data-remote-chat=""
      style={{ paddingBottom: bottom }}
    >
      <AgentView
        source={source}
        drafts={drafts}
        session={session}
        onSessionChange={(next) =>
          next === null ? setSession(null) : onOpenSession(next)
        }
        host={host}
        phone
        leading={
          <IconButton
            icon={commonIcons.back}
            label={t("remote.button.back")}
            size="sm"
            onClick={onBack}
          />
        }
      />
    </div>
  );
}

/**
 * 가상 keyboard가 가리는 아래 높이. layout viewport가 줄지 않는 browser(iOS Safari)에서는 keyboard가 화면 아래를 덮으므로
 * 그만큼 띄워 입력 칸이 keyboard 위에 남게 한다. viewport가 함께 줄면 0이다.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    const viewport = globalThis.visualViewport;
    if (!viewport) return;
    const measure = () => {
      const next = Math.max(
        0,
        Math.round(innerHeight - viewport.height - viewport.offsetTop),
      );
      if (next === last.current) return;
      last.current = next;
      setInset(next);
    };
    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, []);
  return inset;
}
