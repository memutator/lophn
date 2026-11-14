// phone 화면 틀. page는 network를 모르고 `CoreSource` 하나(phone 껍데기의 `globalThis.lophnRemote`나 개발용 bridge)만 쓴다.
// 화면은 셋이다: session 목록과 Inbox는 아래 탭으로 오가고, 목록·Inbox에서 session을 누르면 대화로 들어간다.
import {
  type ComponentType,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { APPEARANCE_DEFAULTS, appearanceCss } from "@lophn/ui";
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { appList } from "../../../protocol/apps/apps.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import { projectApi } from "../../../protocol/projects/project-api.ts";
import { notificationsIcon } from "../icons/chrome.ts";
import { conversationIcons } from "../icons/conversation.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { useConnection } from "../desktop/connection/connection.tsx";
import { useCoreRead } from "../desktop/connection/core-read.ts";
import { createEventClient } from "../desktop/connection/events/client.ts";
import {
  EventsProvider,
  useSessions,
  useWaiting,
} from "../desktop/connection/events/hooks.tsx";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import { registerToastActionHandler } from "../desktop/connection/toasts/toast-actions.ts";
import {
  type InboxNames,
  InboxNamesProvider,
} from "../desktop/connection/waiting/names.ts";
import { WaitingPage } from "../desktop/connection/waiting/waiting-page.tsx";
import { SessionList, useSessionGroups } from "./session-list.tsx";
import styles from "./remote.module.css";

/**
 * 대화 자리에 꽂는 component의 props. 자리는 아래 탭 없는 화면 전체이고 scroll하지 않는 flex column이라 component가 머리(뒤로,
 * agent, 제목), 자기 scroll(대화 줄), 아래에 붙는 입력 칸을 정한다. 제목은 대화가 읽은 것이 가장 새로워 머리도 대화가 그린다.
 */
export interface RemoteChatProps {
  readonly session: string;
  /** session store가 아직 모르는 session(방금 연 것)이면 null이다. 알게 되면 다시 그린다. */
  readonly agent: AgentId | null;
  readonly workspace: SessionEntry["workspace"];
  /** 다른 session으로 옮겨 간다(대화 안의 session link 등). 뒤로는 이 대화를 연 화면이다. */
  readonly onOpenSession: (session: string) => void;
  /** 이 대화를 연 화면(목록이나 Inbox)으로 돌아간다. */
  readonly onBack: () => void;
}

export type RemoteRoute =
  | { readonly screen: "sessions" }
  | { readonly screen: "inbox" }
  | {
      readonly screen: "chat";
      readonly session: string;
      readonly back: "sessions" | "inbox";
    };

// touch density를 html:root token에 건다. inline `<style>`은 CSP가 막을 수 있어 constructable stylesheet로 붙인다.
function useTouchDensity() {
  useLayoutEffect(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      appearanceCss({ ...APPEARANCE_DEFAULTS, density: "touch" }),
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (one) => one !== sheet,
      );
    };
  }, []);
}

const ALL = { limit: Number.MAX_SAFE_INTEGER };

/** Inbox 줄과 목록 묶음이 id 대신 쓸 project·앱 이름. */
function useNames(): InboxNames {
  const projects = useCoreRead(projectApi.list, ALL).loaded;
  const apps = useCoreRead(appList, ALL).loaded;
  return useMemo(
    () => ({
      projects: new Map(
        projects.state === "ready"
          ? projects.value.projects.map((one) => [one.id, one.title])
          : [],
      ),
      apps: new Map(
        apps.state === "ready"
          ? apps.value.apps.map((one) => [one.id, one.name])
          : [],
      ),
    }),
    [projects, apps],
  );
}

function ConnectionLine({ source }: { source: CoreSource }) {
  const { state } = useConnection(source);
  if (state === "ready") return null;
  return (
    <div className={styles.connection} role="status" data-connection={state}>
      {t(
        state === "starting"
          ? "remote.connection.connecting"
          : "remote.connection.disconnected",
      )}
    </div>
  );
}

function Tabs({
  route,
  onGo,
}: {
  route: "sessions" | "inbox";
  onGo: (screen: "sessions" | "inbox") => void;
}) {
  const { count } = useWaiting();
  const tabs = [
    {
      screen: "sessions",
      icon: conversationIcons.empty,
      label: t("remote.label.tab-sessions"),
    },
    {
      screen: "inbox",
      icon: notificationsIcon,
      label: t("remote.label.tab-inbox"),
    },
  ] as const;
  return (
    <nav className={styles.tabs} aria-label={t("remote.label.tabs")}>
      {tabs.map((tab) => (
        <button
          key={tab.screen}
          type="button"
          className={styles.tab}
          data-tab={tab.screen}
          data-selected={route === tab.screen || undefined}
          aria-current={route === tab.screen ? "page" : undefined}
          onClick={() => onGo(tab.screen)}
        >
          <Icon icon={tab.icon} pixels={iconPixels("large")} />
          {tab.label}
          {tab.screen === "inbox" && count > 0 ? (
            <span className={styles.count}>{count}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

function Frame({
  source,
  chat: Chat,
}: {
  source: CoreSource;
  chat: ComponentType<RemoteChatProps>;
}) {
  const [route, setRoute] = useState<RemoteRoute>({ screen: "sessions" });
  const names = useNames();
  const groups = useSessionGroups(names);
  const { sessions } = useSessions();

  const open = useCallback(
    (session: string) =>
      setRoute((now) => ({
        screen: "chat",
        session,
        back: now.screen === "chat" ? now.back : now.screen,
      })),
    [],
  );

  // Inbox 안의 일(알림 action이 연 대화, toast 행동)은 desktop router 대신 이 화면 이동으로 받는다.
  // 앱 공간은 phone에 없어 앱을 여는 행동은 받고 아무것도 하지 않는다.
  useEffect(
    () =>
      registerToastActionHandler((action) => {
        if (action.kind === "waiting") setRoute({ screen: "inbox" });
        else if (action.session !== null) open(action.session);
        return true;
      }),
    [open],
  );

  let body;
  if (route.screen === "chat") {
    const entry = sessions.find((one) => one.session === route.session);
    body = (
      <main className={styles.chat}>
        <Chat
          key={route.session}
          session={route.session}
          agent={entry?.agent ?? null}
          workspace={entry?.workspace ?? null}
          onOpenSession={open}
          onBack={() => setRoute({ screen: route.back })}
        />
      </main>
    );
  } else if (route.screen === "inbox") {
    body = (
      <main className={styles.body}>
        <WaitingPage active onOpenSession={open} />
      </main>
    );
  } else {
    body = (
      <main className={styles.body}>
        <SessionList groups={groups} onOpen={open} />
      </main>
    );
  }

  return (
    <InboxNamesProvider value={names}>
      <div className={styles.root}>
        <ConnectionLine source={source} />
        {body}
        {route.screen === "chat" ? null : (
          <Tabs route={route.screen} onGo={(screen) => setRoute({ screen })} />
        )}
      </div>
    </InboxNamesProvider>
  );
}

/**
 * phone 화면 하나. event 연결은 source마다 하나다. 터미널(`lophnTerminal`)과 desktop 알림(`lophnNotice`)은 phone에 없어
 * 끝난 터미널 줄과 못 본 turn 줄은 생기지 않는다.
 */
export function RemoteApp({
  source,
  chat,
}: {
  source: CoreSource;
  chat: ComponentType<RemoteChatProps>;
}) {
  useTouchDensity();
  const client = useMemo(() => createEventClient(source), [source]);
  return (
    <EventsProvider client={client}>
      <Frame source={source} chat={chat} />
    </EventsProvider>
  );
}
