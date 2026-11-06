// 터미널 탭의 GUI view와 toggle. 탭은 xterm(`TerminalTab`)과 채팅 화면(`TerminalGui`)을 오간다. PTY는 host가, xterm은 창의
// `TerminalDisplays`가 쥐고 있어 어느 쪽을 그리든 둘 다 산다. GUI의 대화는 main이 쥔 handle(extension harness-gui)이고,
// 이 화면은 handle의 갱신을 접어 `AgentView`로 그린다.
import { t } from "@lophn/i18n";
import { Dialog, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  type AcpState,
  type AcpUpdate,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../../protocol/coding-agent/harness-adapter.ts";
import type { BusEvent } from "../../../protocol/events/mod.ts";
import {
  type GuiHarness,
  isGuiHarness,
} from "../../../protocol/extensions/mod.ts";
import type {
  HarnessGuiHandoff,
  HarnessGuiInfo,
  HarnessGuiTabApi,
  HarnessGuiTabToggleReply,
} from "../../ipc/harness-gui.ts";
import { guiAgentTabSource } from "../conversation/agent-tab-gui-source.ts";
import { AgentView, type AgentViewHost } from "../conversation/agent-view.tsx";
import { DraftStore } from "../conversation/drafts.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { EventsProvider } from "../desktop/connection/events/hooks.tsx";
import type {
  EventClient,
  EventMessage,
} from "../desktop/connection/events/client.ts";
import { NoticeToast } from "../editor/notices.tsx";
import {
  actionIcons,
  conversationIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import { newId } from "../prefixed-id.ts";
import type { TabItem } from "../workspace/model.ts";
import type { TabHost } from "../workspace/kinds/host.ts";
import type { TerminalDeps } from "./deps.ts";
import { useGuiRequests } from "./use-gui-requests.ts";

// ---- 탭 fields ----

/** 탭이 쥔 GUI handle. 앱을 다시 켜면 PTY도 GUI process도 남지 않아 저장하지 않는다. */
export interface GuiField {
  readonly handle: string;
  readonly harness: GuiHarness;
  readonly handoff: HarnessGuiHandoff;
}

export function guiOf(tab: TabItem): GuiField | null {
  const gui = tab.fields?.gui as Partial<GuiField> | undefined;
  return typeof gui?.handle === "string" &&
    isGuiHarness(gui.harness) &&
    (gui.handoff === "restart" || gui.handoff === "shared")
    ? { handle: gui.handle, harness: gui.harness, handoff: gui.handoff }
    : null;
}

/** 탭이 지금 그리는 쪽. handle이 없으면 TUI(xterm)다. */
export function viewOf(tab: TabItem): "gui" | "tui" {
  return tab.fields?.view === "gui" && guiOf(tab) !== null ? "gui" : "tui";
}

export function guiApi(): HarnessGuiTabApi | null {
  return (
    (globalThis as { lophnHarnessGuiTab?: HarnessGuiTabApi })
      .lophnHarnessGuiTab ?? null
  );
}

// ---- 갱신 feed ----

// handle의 갱신을 `EMPTY_ACP_STATE`부터 접는다. 대화 화면은 core 없이 갱신만 보므로 이 feed가 화면의 두 길에 답한다:
// `AcpUpdated` event를 구독하는 event client와 snapshot을 읽는 source. 갱신은 main의 handle이 처음부터 보내 주므로 늦게
// 붙은 화면도 같은 상태가 된다. 순번이 빠지면 `reread`가 서지만 다시 읽을 곳이 없어 받은 대로 그린다.
interface GuiFeed {
  readonly session: string;
  readonly client: EventClient;
  state(): AcpState;
  push(update: AcpUpdate): void;
  /** 갱신을 접은 뒤마다 부른다. */
  watch(listener: () => void): () => void;
}

// 대기 목록·session 상태 같은 core 쪽 구독은 이 화면에 없다.
const NO_CORE: CoreSource = {
  subscribe: () => () => {},
  call: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "this view has no core" },
    }),
};

function createGuiFeed(now: () => number): GuiFeed {
  const session = newId("ses", now());
  let state = EMPTY_ACP_STATE;
  const listeners = new Set<(message: EventMessage) => void>();
  const watchers = new Set<() => void>();
  return {
    session,
    state: () => state,
    watch(listener) {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
    push(update) {
      state = reduceAcp(state, update);
      for (const watcher of [...watchers]) watcher();
      const event = {
        type: "AcpUpdated",
        subject: null,
        at: new Date(now()).toISOString(),
        payload: { session, update },
      } as BusEvent;
      for (const listener of [...listeners]) listener({ kind: "event", event });
    },
    client: {
      core: NO_CORE,
      subscribe(condition, onMessage) {
        // 붙을 수 있는 것은 ACP 갱신뿐이다. 다른 구독에는 ready도 event도 가지 않는다.
        if (condition.types?.includes("AcpUpdated") !== true) return () => {};
        listeners.add(onMessage);
        queueMicrotask(() => {
          if (listeners.has(onMessage)) onMessage({ kind: "ready" });
        });
        return () => void listeners.delete(onMessage);
      },
    },
  };
}

// ---- toggle ----

/** modal이 "멈출 일"로 보일 것. */
export interface GuiStops {
  readonly turn: boolean;
  readonly tasks: number;
}

interface ToggleOptions {
  api: HarnessGuiTabApi | null;
  terminalRef: string | null;
  /** 이 단추가 보내는 쪽. */
  to: "gui" | "tui";
  harness: GuiHarness;
  /**
   * 누를 때 부른다. null이면 modal 없이 바로 바꾼다(shared의 view 전환). 아니면 process를 한 번 껐다 켜므로 modal로 묻고
   * 멈출 일을 보인다.
   */
  confirm: () => GuiStops | null | Promise<GuiStops | null>;
  /** 지금은 바꿀 수 없다는 이유. 있으면 단추가 disabled이고 이유가 tooltip으로 보인다. */
  unavailable?: string | null;
}

// 단추는 card 머리에 올라가고 머리는 deps가 바뀔 때마다 다시 서서 그 안의 상태가 사라진다. modal과 오류는 이 hook을 쓰는
// 본문(늘 서 있다)이 그리고, 단추만 머리로 올린다. 단추는 값이 같으면 같은 element라 머리가 다시 서지 않는다.
export function useGuiToggle(options: ToggleOptions): {
  button: ReactNode;
  overlays: ReactNode;
  busy: boolean;
  /** 단추를 누른 것과 같다: modal로 확인하고 바꾼다. 머리 ⋯ 메뉴의 항목이 부른다. */
  start: () => void;
} {
  const { to, harness } = options;
  // modal이 열려 있으면 멈출 일이다.
  const [stops, setStops] = useState<GuiStops | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = HARNESS_ADAPTERS[harness].label;
  const latest = useRef(options);
  latest.current = options;
  const ready = options.api !== null && options.terminalRef !== null;

  const run = async () => {
    const { api, terminalRef, to: target } = latest.current;
    if (api === null || terminalRef === null) return;
    setStops(null);
    setBusy(true);
    const reply = await api.toggle({ terminal_ref: terminalRef, to: target });
    setBusy(false);
    if (!reply.ok) setProblem(problemText(reply));
  };
  // run은 ref와 setter만 읽어 어느 render의 것이어도 같다.
  const startRef = useRef<() => void>(() => {});
  startRef.current = () =>
    void Promise.resolve(latest.current.confirm()).then((asked) => {
      if (asked === null) void run();
      else setStops(asked);
    });
  const start = useCallback(() => startRef.current(), []);
  const unavailable = options.unavailable ?? null;
  const button = useMemo(() => {
    const node = (
      <Button
        size="sm"
        variant="ghost"
        icon={to === "tui" ? workspaceIcons.terminal : conversationIcons.dock}
        disabled={busy || !ready || unavailable !== null}
        onClick={start}
        data-gui-toggle={to}
      >
        {to === "tui"
          ? t("terminal.button.show-terminal")
          : t("terminal.button.show-chat")}
      </Button>
    );
    // disabled 단추는 hover를 받지 못해 감싼 요소가 tooltip을 받는다.
    return unavailable === null ? (
      node
    ) : (
      <Tooltip content={unavailable}>
        <span style={{ display: "inline-flex" }}>{node}</span>
      </Tooltip>
    );
  }, [to, busy, ready, unavailable, start]);
  const overlays = (
    <>
      <Dialog
        open={stops !== null}
        onOpenChange={(open) => {
          if (!open) setStops(null);
        }}
        title={t("terminal.title.switch", { harness: label })}
        actions={
          <>
            <Button onClick={() => setStops(null)}>
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="primary"
              icon={actionIcons.refresh}
              onClick={() => void run()}
            >
              {t("terminal.button.switch")}
            </Button>
          </>
        }
      >
        <p>
          {t("terminal.dialog.switch-text", {
            harness: label,
            target:
              to === "tui"
                ? t("terminal.label.target-terminal")
                : t("terminal.label.target-chat"),
          })}
        </p>
        {stops?.turn ? <p>{t("terminal.dialog.stop-turn")}</p> : null}
        {stops !== null && stops.tasks > 0 ? (
          <p>{t("terminal.dialog.stop-tasks", { count: stops.tasks })}</p>
        ) : null}
      </Dialog>
      {problem === null ? null : (
        <NoticeToast title={problem} onClose={() => setProblem(null)} />
      )}
    </>
  );
  return { button, overlays, busy, start };
}

function problemText(
  reply: Extract<HarnessGuiTabToggleReply, { ok: false }>,
): string {
  switch (reply.reason) {
    case "no_session":
      return t("terminal.error.switch-no-session");
    case "not_running":
      return t("terminal.error.switch-not-running");
    default:
      return t("terminal.error.switch-failed", { message: reply.message });
  }
}

// ---- GUI view ----

// 열 곳이 없는 칸들이다. 이 대화는 이 탭 하나다.
const NOWHERE = () => {};

export function TerminalGui({
  api,
  gui,
  terminalRef,
  drafts,
  host,
  onTitle,
  now = Date.now,
}: {
  api: HarnessGuiTabApi;
  gui: GuiField;
  terminalRef: string | null;
  drafts?: DraftStore;
  host?: Partial<AgentViewHost>;
  /** CLI session 제목이 생기거나 바뀌었다(`/rename`, resume). 탭 이름이 따라간다. */
  onTitle?: (title: string) => void;
  now?: () => number;
}) {
  const feed = useMemo(() => createGuiFeed(now), [gui.handle, now]);
  useEffect(() => {
    if (onTitle === undefined) return;
    let last: string | null = null;
    return feed.watch(() => {
      // 제목이 아직 없는 새 session은 TUI처럼 harness 이름이다.
      const title =
        feed.state().session?.title || HARNESS_ADAPTERS[gui.harness].label;
      if (title === last) return;
      last = title;
      onTitle(title);
    });
  }, [feed, onTitle, gui.harness]);
  const own = useMemo(() => new DraftStore(), []);
  const [info, setInfo] = useState<HarnessGuiInfo | null>(null);
  useEffect(() => {
    let live = true;
    void api.connect(gui.handle, feed.push).then((read) => {
      if (live) setInfo(read);
    });
    return () => {
      live = false;
      void api.disconnect(gui.handle);
    };
  }, [api, gui.handle, feed]);
  const source = useMemo(
    () =>
      info === null
        ? null
        : guiAgentTabSource({
            info,
            feed,
            input: (input) => api.input(gui.handle, input),
            sessions: () => api.sessions(gui.handle),
            rewindPreview: (message) => api.rewindPreview(gui.handle, message),
            writeImage: async (image) =>
              await api.uploadImage(gui.handle, {
                name: image instanceof File ? image.name : "image",
                mime: image.type,
                data: new Uint8Array(await image.arrayBuffer()),
              }),
          }),
    [api, gui.handle, feed, info],
  );
  // restart는 process를 끄고 같은 대화를 TUI로 잇는다(modal). shared는 server가 그대로라 view만 바뀐다.
  const toggle = useGuiToggle({
    api,
    terminalRef,
    to: "tui",
    harness: gui.harness,
    confirm: async () => {
      if (gui.handoff !== "restart") return null;
      // 도는 turn은 화면이 알고, background task는 run(extension)만 안다.
      const running =
        terminalRef === null ? null : await api.running(terminalRef);
      return {
        turn: feed.state().turn !== null || running?.turn === true,
        tasks: running?.tasks ?? 0,
      };
    },
  });
  return (
    <>
      {source === null ? null : (
        <EventsProvider client={feed.client}>
          <AgentView
            source={source}
            drafts={drafts ?? own}
            session={feed.session}
            onSessionChange={NOWHERE}
            host={{
              openPermissions: NOWHERE,
              openAgentSettings: NOWHERE,
              openForked: NOWHERE,
              showUsage: NOWHERE,
              closeTab: NOWHERE,
              ...host,
            }}
            now={now}
            trailing={toggle.button}
            extraMenu={{
              items: [
                {
                  id: OPEN_TERMINAL_ID,
                  label: t("terminal.menu.open-terminal"),
                  leading: <MenuIcon icon={workspaceIcons.terminal} />,
                },
              ],
              onSelect: (id) => {
                if (id === OPEN_TERMINAL_ID) toggle.start();
              },
            }}
          />
        </EventsProvider>
      )}
      {toggle.overlays}
    </>
  );
}

// 채팅 머리의 ⋯ 메뉴 끝에 "Open in terminal"을 더해 터미널 탭의 "Open as chat"과 같은 자리에 둔다.
export const OPEN_TERMINAL_ID = "open-terminal";

// ---- 탭에 묶기 ----

/**
 * 터미널 탭의 본문. 탭의 `view`가 gui이면 채팅 화면을, 아니면 `children`(xterm)을 그린다. main의 "GUI가 열렸다"와 view
 * 바꿈 push를 듣고 탭 fields를 고친다. 이 탭에 handle이 붙었다 닫히는 일은 여기 하나가 한다.
 */
export function GuiSwitch({
  tab,
  host,
  deps,
  children,
}: {
  tab: TabItem;
  host: TabHost;
  deps: TerminalDeps;
  children: ReactNode;
}) {
  const { store } = deps;
  const entry = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(tab.key),
  );
  const terminalRef = entry?.terminalRef ?? null;
  const api = guiApi();
  useGuiRequests(api, terminalRef, {
    opened: (open) =>
      host.patchTab(tab.key, (current) => ({
        fields: {
          ...current.fields,
          view: "gui",
          gui: {
            handle: open.handle,
            harness: open.harness,
            handoff: open.handoff,
          },
        },
      })),
    view: (change) =>
      host.patchTab(tab.key, (current) => {
        const { gui: _gone, ...rest } = current.fields ?? {};
        return {
          fields: change.closed
            ? { ...rest, view: "tui" }
            : { ...current.fields, view: change.view },
        };
      }),
  });
  // GUI 동안에는 TUI가 제목을 알리지 않으므로 CLI session 제목을 탭 이름으로 쓴다. 사람이 붙인 이름이 먼저다.
  const onTitle = useCallback(
    (title: string) =>
      host.patchTab(tab.key, (current) => {
        const person = current.fields?.name;
        return typeof person === "string" && person.length > 0 ? {} : { title };
      }),
    [host, tab.key],
  );
  const gui = guiOf(tab);
  if (api === null || gui === null || viewOf(tab) !== "gui") return children;
  const agentView = host.agentView;
  return (
    <TerminalGui
      key={gui.handle}
      api={api}
      gui={gui}
      terminalRef={terminalRef}
      onTitle={onTitle}
      {...(agentView === null ? {} : { drafts: agentView.drafts })}
      host={{
        ...(agentView === null
          ? {}
          : {
              openFile: (path: string) => agentView.openFile(path, tab.key),
              runCommand: agentView.runCommand,
              artifacts: agentView.artifacts,
              openAgentSettings: (target: "skills" | "mcp") =>
                agentView.openSettings(target),
              openConnections: agentView.openConnections,
            }),
      }}
      {...(agentView?.now === undefined ? {} : { now: agentView.now })}
    />
  );
}
