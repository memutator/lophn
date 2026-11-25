// 터미널 탭의 GUI view와 toggle. 탭은 xterm(`TerminalTab`)과 채팅 화면(`TerminalGui`)을 오간다. PTY와 GUI handle은 core가,
// xterm은 창의 `TerminalDisplays`가 쥐고 있어 어느 쪽을 그리든 둘 다 산다. 탭이 지금 어느 쪽인지는 core의 coding session 목록
// (`coding_sessions/list`)이 말하고, 바꾸기는 `coding_sessions/switch`다. GUI의 대화는 core의 ACP 길(`acp/snapshot`, `AcpUpdated`,
// `acp/send`)이고 이 화면은 그것을 접어 `AgentView`로 그린다.
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
  type AcpInput,
  type AcpState,
  type AcpUpdate,
  acpSend,
  acpSnapshot,
  acpToolBodyRead,
  EMPTY_ACP_STATE,
  type GuiHarness,
  isGuiHarness,
  reduceAcp,
} from "../../../protocol/acp/mod.ts";
import type { Route } from "../../../protocol/base/route.ts";
import { HARNESS_ADAPTERS } from "../../../protocol/coding-agent/harness-adapter.ts";
import {
  type CodingSession,
  codingSessionsCliSessions,
  codingSessionsRewindPreview,
  codingSessionsSwitch,
  codingSessionsSwitchPlan,
} from "../../../protocol/coding-agent/relay.ts";
import type { BusEvent } from "../../../protocol/events/mod.ts";
import { blocksText } from "../../../protocol/lophn-agent/content-block.ts";
import { terminalSessionId } from "../../../protocol/lophn-agent/session-tag.ts";
import { guiAgentTabSource } from "../conversation/agent-tab-gui-source.ts";
import { AgentView, type AgentViewHost } from "../conversation/agent-view.tsx";
import { desktopParts } from "../conversation/desktop-parts-impl.tsx";
import { DraftStore } from "../conversation/drafts.ts";
import { useReportVisible } from "../conversation/report-visible.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { readRoute } from "../desktop/connection/core-read.ts";
import type {
  EventClient,
  EventMessage,
} from "../desktop/connection/events/client.ts";
import { EventsProvider } from "../desktop/connection/events/hooks.tsx";
import { NoticeToast } from "../editor/notices.tsx";
import {
  actionIcons,
  conversationIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import { newId } from "../prefixed-id.ts";
import { focusTabBody } from "../workspace/focus-tab.ts";
import type { TabHost } from "../workspace/kinds/host.ts";
import type { TabItem } from "../workspace/model.ts";
import type { TerminalCore } from "./core.ts";
import type { TerminalDeps } from "./deps.ts";
import type { TerminalStore } from "./store.ts";

type Blocked = NonNullable<CodingSession["switch"]>["blocked"];

/** 지금 GUI로 바꿀 수 없는 이유의 문구. 바꿀 수 있으면 null이다. */
export function blockedReason(
  blocked: Blocked | null,
): { reason: string; short: string } | null {
  switch (blocked) {
    case null:
      return null;
    case "not_running":
      return {
        reason: t("terminal.reason.foreground"),
        short: t("terminal.reason.foreground-short"),
      };
    case "no_session":
      return {
        reason: t("terminal.reason.session"),
        short: t("terminal.reason.session-short"),
      };
    case "unsupported_os":
      return {
        reason: t("terminal.reason.unsupported-os"),
        short: t("terminal.reason.unsupported-os-short"),
      };
  }
}

// 탭의 임시 폴더에 쓴 그림은 확장자가 형식이다(core가 붙일 때 MIME으로 정했다). 읽은 bytes는 octet-stream으로 온다.
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
function imageType(path: string): string {
  return (
    IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ??
    "application/octet-stream"
  );
}

/** 탭이 그리는 GUI. core의 coding session이 GUI view일 때만 있다. */
function guiOf(store: TerminalStore, key: string): CodingSession | null {
  const coding = store.codingOf(key);
  return coding?.view === "gui" && isGuiHarness(coding.harness) ? coding : null;
}

/** GUI view가 알린 ACP session 제목. GUI를 그리는 동안만 있다(저장본에 남은 옛 값은 무시한다). */
export function guiTitleOf(tab: TabItem, store: TerminalStore): string | null {
  const title = tab.fields?.guiTitle;
  return guiOf(store, tab.key) !== null && typeof title === "string"
    ? title
    : null;
}

// ---- 갱신 feed ----

// core의 snapshot으로 시작해 이어지는 갱신을 접는다. 대화 화면은 이 feed의 event client만 보므로 이 feed가 화면의 두 길에
// 답한다: `AcpUpdated` event를 구독하는 event client와 snapshot을 읽는 source. 다시 붙거나 core가 그 session의 상태를 갈아
// 끼우면(`StateChanged{coding_sessions}`) snapshot을 다시 읽고 화면이 이 feed를 다시 읽는다.
interface GuiFeed {
  readonly session: string;
  readonly client: EventClient;
  state(): AcpState;
  /** snapshot이 있으면 상태를 갈아 끼우고, 갱신은 모두 접은 뒤 한 번에 알린다. */
  apply(batch: { snapshot?: AcpState; updates: readonly AcpUpdate[] }): void;
  /** 갱신을 접은 뒤마다 부른다. */
  watch(listener: () => void): () => void;
  /** snapshot으로 상태가 통째로 바뀌었다. 화면이 다시 읽는다. */
  changed(listener: () => void): () => void;
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

function createGuiFeed(session: string, now: () => number): GuiFeed {
  let state = EMPTY_ACP_STATE;
  const listeners = new Set<(message: EventMessage) => void>();
  const watchers = new Set<() => void>();
  const resets = new Set<() => void>();
  return {
    session,
    state: () => state,
    watch(listener) {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
    changed(listener) {
      resets.add(listener);
      return () => void resets.delete(listener);
    },
    apply({ snapshot, updates }) {
      if (snapshot !== undefined) state = snapshot;
      for (const update of updates) state = reduceAcp(state, update);
      for (const watcher of [...watchers]) watcher();
      if (snapshot !== undefined) for (const reset of [...resets]) reset();
      // 한 batch는 한 task 안에서 모두 내보내 React가 한 번만 그린다.
      for (const update of updates) {
        const event = {
          type: "AcpUpdated",
          session,
          subject: null,
          at: new Date(now()).toISOString(),
          payload: { session, update },
        } as BusEvent;
        for (const listener of [...listeners]) {
          listener({ kind: "event", event });
        }
      }
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

export interface FrameScheduler {
  schedule(run: () => void): () => void;
}

const DEFAULT_FRAME_SCHEDULER: FrameScheduler = {
  schedule(run) {
    if (typeof globalThis.requestAnimationFrame === "function") {
      const id = globalThis.requestAnimationFrame(() => run());
      return () => globalThis.cancelAnimationFrame(id);
    }
    const timer = setTimeout(run, 16);
    return () => clearTimeout(timer);
  },
};

/**
 * core의 ACP 길을 feed에 잇는다. 갱신 구독이 서면(ready) snapshot을 읽고, 읽는 사이 온 갱신은 snapshot 뒤에 접는다.
 * live 갱신은 한 animation frame 동안 모아 한 번에 `feed.apply`로 반영한다. 첫 snapshot을 받으면 `onLoaded`다. 해지를 돌려준다.
 */
export function followGui(
  events: EventClient,
  feed: GuiFeed,
  onLoaded: () => void,
  frame: FrameScheduler = DEFAULT_FRAME_SCHEDULER,
): () => void {
  let buffer: AcpUpdate[] | null = null;
  let pending: AcpUpdate[] = [];
  let cancelFrame: (() => void) | null = null;
  let reads = 0;
  let stopped = false;

  const clearPending = () => {
    cancelFrame?.();
    cancelFrame = null;
    pending = [];
  };

  const flush = () => {
    cancelFrame = null;
    if (stopped || pending.length === 0) return;
    const updates = pending;
    pending = [];
    feed.apply({ updates });
  };

  const enqueue = (update: AcpUpdate) => {
    pending.push(update);
    if (cancelFrame === null) cancelFrame = frame.schedule(flush);
  };

  async function load() {
    clearPending();
    const mine = ++reads;
    buffer = [];
    const read = await readRoute(events.core, acpSnapshot, {
      session: feed.session,
    });
    if (stopped || mine !== reads) return;
    const updates = buffer;
    buffer = null;
    if (!read.ok) return;
    feed.apply({ snapshot: read.value, updates });
    onLoaded();
  }
  const offUpdates = events.subscribe(
    { session: feed.session, types: ["AcpUpdated"] },
    (message) => {
      if (message.kind === "ready") void load();
      else if (
        message.kind === "event" &&
        message.event.type === "AcpUpdated"
      ) {
        const update = message.event.payload.update;
        if (buffer !== null) buffer.push(update);
        else enqueue(update);
      }
    },
  );
  const offReplaced = events.subscribe(
    { types: ["StateChanged"] },
    (message) => {
      if (
        message.kind === "event" &&
        message.event.type === "StateChanged" &&
        message.event.payload.changes.some(
          (change) =>
            change.name === "coding_sessions" && change.id === feed.session,
        )
      ) {
        void load();
      }
    },
  );
  return () => {
    stopped = true;
    clearPending();
    offUpdates();
    offReplaced();
  };
}

async function callRoute<T>(
  core: CoreSource,
  route: Route,
  body: unknown,
): Promise<
  { ok: true; value: T } | { ok: false; reason: string | null; message: string }
> {
  try {
    const reply = await core.call({
      kind: route.kind,
      resource: route.resource,
      method: route.method,
      body,
    });
    if (reply.ok) return { ok: true, value: reply.value as T };
    const reason = reply.error?.details?.reason;
    return {
      ok: false,
      reason: typeof reason === "string" ? reason : null,
      message: reply.error?.message ?? "",
    };
  } catch {
    return { ok: false, reason: null, message: "" };
  }
}

// ---- toggle ----

/** modal이 "멈출 일"로 보일 것. */
interface GuiStops {
  readonly turn: boolean;
  readonly tasks: number;
  /** GUI queue에 남아 보내지 못할 말의 수. */
  readonly queued: number;
}

interface ToggleOptions {
  core: TerminalCore | null;
  /** 탭의 coding session(`ses_…`). 아직 모르면 null이다. */
  session: string | null;
  /** shared는 TUI와 GUI가 한 server를 나눠 view만 바뀌어 묻지 않는다. 아니면 process를 한 번 껐다 켜므로 modal로 묻는다. */
  handoff: CodingSession["handoff"];
  /** 이 단추가 보내는 쪽. */
  to: "gui" | "tui";
  harness: GuiHarness;
  /** 지금은 바꿀 수 없다는 이유. 있으면 단추가 disabled이고 이유가 tooltip으로 보인다. */
  unavailable?: string | null;
  /**
   * 바꾸기로 한 순간(응답을 기다리기 전)에 부른다. 돌려준 함수는 바뀐 뒤에만 부른다: 바꾸다 실패하면 queue의 말이 그대로라
   * 입력칸에 옮기면 두 번이 된다.
   */
  onSwitch?: () => () => void;
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
  const ready = options.core !== null && options.session !== null;

  const loadPlan = (core: TerminalCore, session: string) => {
    void readRoute(core.events.core, codingSessionsSwitchPlan, {
      session,
    }).then((plan) => {
      if (!plan.ok) setProblem(problemText(null, ""));
      else if (plan.value.blocked !== null) {
        setProblem(problemText(plan.value.blocked, ""));
      } else setStops(plan.value.stops);
    });
  };

  const run = async (expectedStops?: GuiStops) => {
    const { core, session, to: target } = latest.current;
    if (core === null || session === null) return;
    setStops(null);
    setBusy(true);
    const switched = latest.current.onSwitch?.();
    const reply = await callRoute(
      core.events.core,
      codingSessionsSwitch as Route,
      {
        session,
        to: target,
        confirmed: true,
        key: newId("key"),
        ...(expectedStops === undefined ? {} : { stops: expectedStops }),
      },
    );
    setBusy(false);
    if (reply.ok) switched?.();
    else if (reply.reason === "stale_plan") loadPlan(core, session);
    else setProblem(problemText(reply.reason, reply.message));
  };
  // run은 ref와 setter만 읽어 어느 render의 것이어도 같다.
  const startRef = useRef<() => void>(() => {});
  startRef.current = () => {
    const { core, session, handoff } = latest.current;
    if (core === null || session === null) return;
    if (handoff === "shared") {
      void run();
      return;
    }
    loadPlan(core, session);
  };
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
              onClick={() => void run(stops ?? undefined)}
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
        {stops !== null && stops.queued > 0 ? (
          <p>{t("terminal.dialog.stop-queued", { count: stops.queued })}</p>
        ) : null}
      </Dialog>
      {problem === null ? null : (
        <NoticeToast title={problem} onClose={() => setProblem(null)} />
      )}
    </>
  );
  return { button, overlays, busy, start };
}

function problemText(reason: string | null, message: string): string {
  switch (reason) {
    case "no_session":
      return t("terminal.error.switch-no-session");
    case "not_running":
      return t("terminal.error.switch-not-running");
    case "unsupported_os":
      return t("terminal.reason.unsupported-os");
    default:
      return t("terminal.error.switch-failed", { message });
  }
}

// ---- GUI view ----

// 열 곳이 없는 칸들이다. 이 대화는 이 탭 하나다.
const NOWHERE = () => {};

export function TerminalGui({
  core,
  coding,
  drafts,
  host,
  onTitle,
  focusKey = null,
  now = Date.now,
}: {
  core: TerminalCore;
  coding: CodingSession & { harness: GuiHarness };
  drafts?: DraftStore;
  host?: Partial<AgentViewHost>;
  /** CLI session 제목이 생기거나 바뀌었다(`/rename`, resume). 탭 이름이 따라간다. */
  onTitle?: (title: string) => void;
  /** 이 탭을 보고 있으면 그 탭 key. 대화 화면이 그려지면 입력칸으로 focus를 옮긴다. */
  focusKey?: string | null;
  now?: () => number;
}) {
  // session id(`ses_<터미널 ULID>`)는 터미널이 다시 시작해도, GUI를 다시 열어도 같다. 탭을 오가 다시 붙어도 창의 DraftStore가
  // 같은 입력 글과 읽던 위치를 돌려준다(restart는 queue에 남은 말의 글을 입력칸에 되돌려 놓는다).
  const session = coding.session;
  const harness = coding.harness;
  const feed = useMemo(() => createGuiFeed(session, now), [session, now]);
  useEffect(() => {
    if (onTitle === undefined) return;
    let last: string | null = null;
    return feed.watch(() => {
      // 제목이 아직 없는 새 session은 기본 harness 이름을 guiTitle로 쓰지 않는다(기억한 agentTitle을 덮지 않게).
      const title = feed.state().session?.title?.trim() ?? "";
      if (title === last) return;
      last = title;
      onTitle(title);
    });
  }, [feed, onTitle]);
  const own = useMemo(() => new DraftStore(), []);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    return followGui(core.events, feed, () => setLoaded(true));
  }, [core, feed]);
  const cwd = coding.cwd ?? "";
  const agentName = coding.agent_name;
  const source = useMemo(() => {
    if (!loaded) return null;
    const api = core.events.core;
    return guiAgentTabSource({
      info: {
        harness,
        cwd,
        ...(agentName === undefined ? {} : { agentName }),
      },
      feed,
      input: async (input: AcpInput) =>
        (await callRoute(api, acpSend as Route, input)).ok,
      toolBody: async (toolCall, part) => {
        const body = await readRoute(api, acpToolBodyRead, {
          session,
          tool_call: toolCall,
          part,
        });
        return body.ok
          ? { ok: true, value: body.value }
          : { ok: false, code: "not_found" };
      },
      sessions: async () => {
        const read = await readRoute(api, codingSessionsCliSessions, {
          session,
        });
        return read.ok ? read.value.sessions : [];
      },
      rewindPreview: async (message) => {
        const read = await readRoute(api, codingSessionsRewindPreview, {
          session,
          message,
        });
        return read.ok ? read.value.preview : null;
      },
      writeImage: async (image) => {
        const bytes = new Uint8Array(await image.arrayBuffer());
        try {
          const reply = await api.call({
            kind: "upload",
            resource: "acp",
            method: "image_upload",
            body: { session, content_type: image.type, bytes: bytes.length },
            bytes,
          });
          return reply.ok ? (reply.value as { path: string }).path : null;
        } catch {
          return null;
        }
      },
      readImage: async (path) => {
        try {
          const reply = await api.call({
            kind: "file",
            resource: "acp",
            method: "image_read",
            body: { session, path },
          });
          if (!reply.ok) return null;
          const file = reply.value as { bytes: Uint8Array };
          return new Blob([file.bytes.slice()], { type: imageType(path) });
        } catch {
          return null;
        }
      },
    });
  }, [core, feed, loaded, harness, cwd, agentName, session]);
  // 고른 탭만 mount되므로 탭을 고르거나 TUI에서 GUI로 바꿀 때마다 새로 붙고, 입력칸은 snapshot을 읽은 뒤에야 생긴다.
  // 탭을 고른 다음 frame의 focus는 빈 본문을 보므로 화면이 그려진 이때 옮긴다.
  const shown = source !== null;
  useEffect(() => {
    if (shown && focusKey !== null) focusTabBody(focusKey);
  }, [shown, focusKey]);
  // restart는 process를 끄고 같은 대화를 TUI로 잇는다(modal). shared는 server가 그대로라 view만 바뀐다.
  const toggle = useGuiToggle({
    core,
    session,
    handoff: coding.handoff,
    to: "tui",
    harness,
    // queue에 남은 말은 TUI로 가며 사라지니, 글만 입력칸에 되돌려 놓는다(첨부는 잃는다).
    onSwitch: () => {
      const queued = feed
        .state()
        .queued.map((item) => blocksText(item.content))
        .filter((text) => text !== "")
        .join("\n\n");
      return () => {
        if (queued === "") return;
        const mine = (drafts ?? own).draft(feed.session).text;
        const text = mine === "" ? queued : `${mine}\n\n${queued}`;
        (drafts ?? own).save(feed.session, {
          text,
          selection: [text.length, text.length],
        });
      };
    },
  });
  return (
    <>
      {source === null ? null : (
        <EventsProvider client={feed.client}>
          {/* key context `agentView`은 이 바깥 칸이고, AgentView 안의 `agentView:<harness>`가 CLI key를 먼저 든다. 칸은 상자를 만들지 않는다. */}
          <div data-key-context="agentView" style={{ display: "contents" }}>
            <AgentView
              source={source}
              harness={harness}
              drafts={drafts ?? own}
              session={feed.session}
              onSessionChange={NOWHERE}
              host={{
                openPermissions: NOWHERE,
                openAgentSettings: NOWHERE,
                openForked: NOWHERE,
                desktop: desktopParts,
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
          </div>
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
 * 터미널 탭의 본문. core의 coding session이 GUI view이면 채팅 화면을, 아니면 `children`(xterm)을 그린다. 어느 창이 바꾸든(폰도)
 * 목록이 바뀌면 모든 창의 탭이 따라간다.
 */
export function GuiSwitch({
  tab,
  active,
  host,
  deps,
  children,
}: {
  tab: TabItem;
  active: boolean;
  host: TabHost;
  deps: TerminalDeps;
  children: ReactNode;
}) {
  const { store } = deps;
  useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.version(),
  );
  // 항목이 없거나(다시 켠 앱의 layout에서 읽기만 한 탭) generation이 0인(core가 연 탭) GUI 탭도 core가 알린 runtime으로 안다.
  const terminalRef = store.refOf(tab.key);
  const gui = guiOf(store, tab.key);
  // GUI view에서는 TerminalTab이 서지 않아 main의 focus 표에 이 터미널을 적는 곳이 없다. 고른 GUI 탭도 '보고 있음'이어야
  // 끝난 turn의 점과 알림이 사라진다.
  const showingGui = gui !== null;
  const generation = store.generationOf(tab.key);
  useEffect(() => {
    const bridge = deps.bridge;
    if (
      !active ||
      !showingGui ||
      bridge === null ||
      terminalRef === null ||
      generation < 1
    )
      return;
    const ref = { terminal: terminalRef, generation };
    void bridge.focus({ ...ref, focused: true });
    return () => {
      void bridge.focus({ ...ref, focused: false });
    };
  }, [active, showingGui, deps.bridge, terminalRef, generation]);

  useReportVisible(
    deps.screenCopy === true && showingGui && terminalRef !== null
      ? terminalSessionId(terminalRef)
      : null,
    active,
  );
  // GUI 동안에는 TUI가 제목을 알리지 않으므로 CLI session 제목을 탭 field에 두고, 이름 규칙이 사람 이름 다음으로 쓴다.
  const onTitle = useCallback(
    (title: string) =>
      host.patchTab(tab.key, (current) => {
        const { guiTitle: _old, ...rest } = current.fields ?? {};
        return {
          fields: title.length > 0 ? { ...rest, guiTitle: title } : rest,
        };
      }),
    [host, tab.key],
  );
  if (gui === null || deps.core === null) return children;
  const agentView = host.agentView;
  return (
    <TerminalGui
      key={gui.session}
      core={deps.core}
      coding={gui as CodingSession & { harness: GuiHarness }}
      onTitle={onTitle}
      focusKey={active ? tab.key : null}
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
