// 알림을 어디에 띄울지 정하는 한 곳. 터미널 안 coding agent(core의 `TerminalAgentSignaled`), lophn Agent session(Bus event),
// 사람에게 한 알림(NoticePosted: 앱이 한 것과 program이 남긴 기록)이 같은 규칙(notice/rule.ts)으로 이리 온다: 보고 있으면 없음,
// lophn 창에 focus가 있으면 그 창의 toast, 없으면 OS 알림. 누르면 그 탭(앱 알림은 그 앱 공간)이 있는 창을
// 앞으로 가져오고 고른다. toast를 받는 창은 하나뿐이라 창이 여럿이어도 한 번만 뜬다.
// 무엇을 보고 있는지(창 focus, idle, 보이는 session·터미널)는 core에도 알린다(presence). 못 본 turn 끝(`unseen`)은 core가 든다.
import { BrowserWindow, Notification, powerMonitor } from "electron";

import type { Id } from "../../../../protocol/base/ids.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import {
  ALERT_PROGRAM_KINDS,
  type Notice as NoticeRow,
  type NoticeKind,
  noticesOpen,
} from "../../../../protocol/apps/notice.ts";
import { sessionSnapshotsList } from "../../../../protocol/events/mod.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import { terminalSessionId } from "../../../../protocol/lophn-agent/session-tag.ts";
import { askRead } from "../../../../protocol/lophn-agent/ask-tool.ts";
import { messageBody } from "../../../../protocol/lophn-agent/messages.ts";
import {
  NOTICE_OPEN_CHANNEL,
  NOTICE_REVEAL_CHANNEL,
  NOTICE_TOAST_CHANNEL,
  NOTICE_VISIBLE_CHANNEL,
  type NoticeTarget,
  noticeTargetSchema,
  noticeVisibleSchema,
} from "../../../ipc/notice.ts";
import type { AvatarFace, OverlayLead } from "../../../ipc/overlay.ts";
import { TERMINAL_REVEAL_CHANNEL } from "../../../ipc/terminal.ts";
import { excerpt } from "../../notice/excerpt.ts";
import { createMachinePresence } from "../../notice/presence.ts";
import {
  createSessionNotices,
  routeNotice,
  type SessionEvent,
  type SessionNotice,
  SessionVisibility,
  type SessionWho,
} from "../../notice/rule.ts";
import type { TerminalFocusTable } from "../terminal-focus.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { word } from "../i18n.ts";
import type { Registered, ShellContext } from "./context.ts";
import { openDesktopWindow } from "./desktop-window.ts";

// core 기동 중에 쓰여 shell이 붙기 전에 지나간 기록 가운데 붙은 뒤 다시 읽어 띄우는 것(`notices.open`).
const STARTUP_PROGRAM_KINDS: ReadonlySet<NoticeKind> = new Set([
  "sdk_update_needed",
  "app_unavailable",
]);

// 이 영역이 다른 기계에 거는 구독자 이름(`machines/watch`의 watcher). 창의 `w<id>`와 겹치지 않는다.
const NOTICE_WATCHER = "notice";

// 알림을 띄울 session event(이 컴퓨터와 다른 기계에 같은 조건을 건다).
const SESSION_EVENT_TYPES = [
  "TurnStarted",
  "TurnEnded",
  "TurnRequestOpened",
  "QuestionAsked",
  "SessionEnded",
] as const;

// 다른 기계에 거는 조건: 이 컴퓨터에 거는 알림 조건(session event, 알림 기록, 터미널 coding agent의 신호)이다.
const OTHER_MACHINE_CONDITIONS = [
  { types: [...SESSION_EVENT_TYPES] },
  { types: ["NoticePosted", "TerminalAgentSignaled"] },
];

const TITLES = {
  finished: {
    plain: "common.title.agent-finished",
    placed: "common.title.agent-finished-in",
  },
  failed: {
    plain: "common.title.agent-failed",
    placed: "common.title.agent-failed-in",
  },
  permission: {
    plain: "common.title.agent-needs-permission",
    placed: "common.title.agent-needs-permission-in",
  },
} as const;

// 이 파일이 읽는 core event payload의 칸(protocol/events/agent.ts).
type EventPayload = {
  messages?: string[];
  error?: { message: string } | null;
  request?: {
    subject:
      | { kind: "shell"; command: string }
      | { kind: "harness"; tool: string | null; summary: string | null }
      | { kind: "app_tool" | "mcp_tool"; tool: string };
  };
  tool_call?: string;
};

export type Notice = {
  /** 이 컴퓨터가 아닌 기계의 알림이면 그 기계. 제목에 그 이름이 붙고 누르면 그 기계의 것을 연다. */
  machine?: Id<"mch">;
  kind: keyof typeof TITLES;
  /** 제목에 쓸 누가: harness 제품 이름이나 lophn agent 이름. */
  agent: string;
  /** 어디서: 터미널 탭 이름이나 lophn session(대화) 이름. 제목에 붙는다. 모르면 없다. */
  workspace?: string;
  /** 본문: 마지막 응답의 앞부분, 권한 물음의 요약, 실패 까닭. 없으면 본문이 없다(폴더 이름 같은 것으로 채우지 않는다). */
  body?: string;
  lead?: OverlayLead;
  target: NoticeTarget;
};

function titleOf(kind: keyof typeof TITLES, agent: string, workspace?: string) {
  return workspace === undefined
    ? word(TITLES[kind].plain, { agent })
    : word(TITLES[kind].placed, { agent, workspace });
}

export type NoticeWiring = Registered & {
  /** 알린다. 알렸으면(보고 있지 않았으면) true다. */
  show(notice: Notice): boolean;
  /** 고른 터미널 탭이 바뀌었다. 보고 있는 것을 core에 다시 알린다. */
  terminalFocusChanged(): void;
};

/** 앱 화면이 붙은 session을 쥔 view. main의 앱 agent service가 안다. 앱이 연 session인지는 core가 안다(`opened_by_app`). */
export type AppSessions = {
  viewsOf(session: string): string[];
};

export function createNoticeWiring(
  ctx: ShellContext,
  focus: TerminalFocusTable,
  appSessions: AppSessions,
  // 그 터미널이 속한 project. 터미널을 모르면 undefined다.
  projectOf: (terminalRef: string) => string | undefined,
  // 지금 살아 있는 터미널. 보고 있는 터미널을 고를 때 쓴다.
  terminalRefs: () => string[],
): NoticeWiring {
  const visibility = new SessionVisibility();
  // 기계 이름(알림 제목의 꼬리). 목록에서 빠진 기계는 이름 없이 간다.
  const nameOf = (machine: Id<"mch">) =>
    ctx.machines.list().machines.find((row) => row.id === machine)?.name;
  // 창마다 보이는 앱 화면(view_session). 같은 표 type을 session 대신 view_session으로 쓴다.
  const viewVisibility = new SessionVisibility();
  let serial = 0;

  // focus를 가진 lophn 창. 앱 전용 창 같은 shell 밖의 창은 아니다.
  function focusedWindow(): BrowserWindow | undefined {
    const window = BrowserWindow.getFocusedWindow();
    return window !== null && ctx.windows.has(window) ? window : undefined;
  }

  // 그 탭이 focus를 가진 lophn 창에 보인다.
  function looking(target: NoticeTarget): boolean {
    const window = focusedWindow();
    if (window === undefined) return false;
    const contents = window.webContents.id;
    if (target.kind === "app" || target.kind === "inbox") return false;
    if (target.kind === "terminal") {
      // 다른 기계의 터미널은 이 컴퓨터의 터미널 표에 없다.
      return (
        target.machine === undefined &&
        focus.focused(contents, target.terminal_ref)
      );
    }
    return (
      visibility.isVisible(contents, target.session, target.machine) ||
      // 앱 화면이 쥔 session은 이 컴퓨터의 것만 안다.
      (target.machine === undefined &&
        appSessions
          .viewsOf(target.session)
          .some((view) => viewVisibility.isVisible(contents, view)))
    );
  }

  // 알림을 누르면 그 탭을 가진 창을 앞으로 가져오고 탭을 고르라고 알린다.
  // 탭을 가진 창을 모르면 마지막으로 focus를 받은 창이다(detached 창은 건너뛴다).
  function reveal(target: NoticeTarget): void {
    const live = [...ctx.windows].filter((window) => !window.isDestroyed());
    const owner =
      target.kind === "terminal"
        ? target.machine === undefined
          ? focus.contentsOf(target.terminal_ref)
          : undefined
        : target.kind === "session"
          ? visibility.owner(target.session, target.machine)
          : undefined;
    const found =
      live.find((item) => item.webContents.id === owner) ??
      live.filter((item) => !ctx.detached.has(item)).at(-1) ??
      live.at(-1);
    // A new window gets the same reveal once its page has loaded; the notice preload holds it until the screen subscribes.
    const window = found ?? openDesktopWindow(ctx);
    if (window === undefined) return;
    if (found !== undefined) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    const send = () => {
      if (window.isDestroyed()) return;
      if (target.kind === "terminal") {
        // 다른 기계의 터미널은 renderer가 그 기계의 목록에서 project를 찾아 탭을 연다.
        if (target.machine !== undefined) {
          window.webContents.send(NOTICE_REVEAL_CHANNEL, {
            terminal: target.terminal_ref,
            machine: target.machine,
          });
          return;
        }
        const project = projectOf(target.terminal_ref);
        if (project === undefined) return;
        for (const item of found === undefined ? [window] : live) {
          item.webContents.send(TERMINAL_REVEAL_CHANNEL, {
            terminal: target.terminal_ref,
            project,
          });
        }
      } else if (target.kind === "session") {
        window.webContents.send(NOTICE_REVEAL_CHANNEL, {
          session: target.session,
          ...(target.machine === undefined ? {} : { machine: target.machine }),
        });
      } else if (target.kind === "app") {
        window.webContents.send(NOTICE_REVEAL_CHANNEL, {
          app: target.app,
          ...(target.machine === undefined ? {} : { machine: target.machine }),
        });
      } else {
        window.webContents.send(NOTICE_REVEAL_CHANNEL, { inbox: true });
      }
    };
    if (found === undefined) window.webContents.once("did-finish-load", send);
    else send();
  }

  // GC가 알림을 거두면 click이 오지 않는다.
  const shown = new Set<Notification>();
  // icon은 쓰지 않는다. harness 아이콘은 renderer 안의 svg뿐이라 OS 알림에 줄 png가 없다.
  function osNotify(
    title: string,
    body: string | undefined,
    target: NoticeTarget,
  ): void {
    if (ctx.headless.headless || !Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    shown.add(notification);
    notification.on("click", () => reveal(target));
    notification.on("close", () => shown.delete(notification));
    notification.on("failed", () => shown.delete(notification));
    notification.show();
  }

  // 알림을 띄울 곳을 정하는 한 곳이다. 보고 있으면 없음, toast를 받을 창이 있으면 toast, 아니면 OS 알림.
  function present(
    title: string,
    body: string | undefined,
    lead: OverlayLead | undefined,
    target: NoticeTarget,
  ): boolean {
    const window = focusedWindow();
    const route = routeNotice({
      looking: looking(target),
      // detached 창에는 toast 표면이 없다.
      toastable: window !== undefined && !ctx.detached.has(window),
    });
    if (route === "toast") {
      serial += 1;
      window!.webContents.send(NOTICE_TOAST_CHANNEL, {
        id: `notice-${serial}`,
        title,
        body,
        lead,
        target,
      });
    } else if (route === "os") osNotify(title, body, target);
    return route !== "none";
  }

  // 다른 기계의 알림은 제목 끝에 그 기계 이름이 붙는다.
  function onMachine(title: string, machine: Id<"mch"> | undefined): string {
    const name = machine === undefined ? undefined : nameOf(machine);
    return name === undefined ? title : `${title} · ${name}`;
  }

  function show(notice: Notice): boolean {
    return present(
      onMachine(
        titleOf(notice.kind, notice.agent, notice.workspace),
        notice.machine,
      ),
      notice.body,
      notice.lead,
      notice.target,
    );
  }

  // core 읽기 하나(그 기계의 core). 읽지 못하거나 모양이 다르면 null이다(알림이 안 뜨는 것보다 본문이 비는 쪽이 낫다).
  async function read<T>(
    machine: Id<"mch"> | null,
    kind: "read" | "memory",
    route: {
      resource: string;
      method: string;
      output: {
        safeParse(
          value: unknown,
        ): { success: true; data: T } | { success: false };
      };
    },
    input: unknown,
  ): Promise<T | null> {
    const reply =
      machine === null
        ? await ctx.coreInternal(kind, route.resource, route.method, input)
        : await ctx.machines.link(machine).call({
            resource: route.resource,
            method: route.method,
            body: input,
          });
    if (!reply.ok) return null;
    const parsed = route.output.safeParse(reply.value);
    return parsed.success ? parsed.data : null;
  }

  // 누구의 어느 session인지. agent 이름·profile은 사람이 바꿀 수 있고 session 이름도 바뀌어서 알릴 때마다 읽는다.
  async function who(
    machine: Id<"mch"> | null,
    session: string,
  ): Promise<SessionWho | null> {
    const snapshots = await read(machine, "read", sessionSnapshotsList, {
      sessions: [session],
    });
    const agent = snapshots?.snapshots[0]?.agent;
    if (agent === undefined) return null;
    const [definition, record] = await Promise.all([
      read(machine, "read", agentRead, { agent }),
      read(machine, "read", workspaceSessionRead, { session }),
    ]);
    // 정의를 읽지 못하면 이름 대신 lophn과 그 밖의 agent만 가른다.
    const name =
      definition?.effective.name.value ??
      word(
        isLophn(agent)
          ? "waiting.label.agent-lophn"
          : "waiting.label.agent-unnamed",
      );
    const profile = definition?.effective.profile.value;
    // 올린 이미지는 renderer만 읽을 주소가 있어 이름 첫 글자로 갈음한다(Agent 화면 머리와 같다).
    const face: AvatarFace =
      profile?.kind === "character"
        ? profile
        : { kind: "initial", text: [...name][0] };
    const title = record?.session.title ?? undefined;
    return {
      session,
      agent: name,
      profile: face,
      ...(title === undefined ? {} : { title }),
    };
  }

  // 끝난 turn의 마지막 답 글. TurnEnded가 싣는 message 중 글이 있는 마지막 것이다(app 카드만 있는 답은 건너뛴다).
  async function lastAnswer(
    machine: Id<"mch"> | null,
    messages: string[],
  ): Promise<string | undefined> {
    for (const message of messages.toReversed()) {
      const body = await read(machine, "read", messageBody, { message });
      const text = body?.content.parts
        .flatMap((part) => (part.kind === "text" ? [part.text] : []))
        .join("\n");
      const found = excerpt(text);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  // 알림 본문. 알 수 없으면 없다.
  async function bodyOf(
    machine: Id<"mch"> | null,
    kind: SessionNotice["kind"],
    event: SessionEvent,
  ): Promise<string | undefined> {
    const payload = event.payload as EventPayload | undefined;
    if (kind === "finished") {
      return await lastAnswer(machine, payload?.messages ?? []);
    }
    if (kind === "failed") return excerpt(payload?.error?.message);
    if (event.type === "TurnRequestOpened") {
      const subject = payload?.request?.subject;
      return excerpt(
        subject?.kind === "shell"
          ? subject.command
          : subject?.kind === "harness"
            ? (subject.summary ?? subject.tool)
            : subject?.tool,
      );
    }
    const asked = await read(machine, "memory", askRead, {
      session: event.session,
      tool_call: payload?.tool_call,
    });
    return excerpt(asked?.questions[0].question);
  }

  // 기계마다 알림 규칙 하나(읽기와 알림의 대상이 그 기계다). 처음 쓸 때 짓는다.
  const sessionNotices = new Map<
    Id<"mch"> | null,
    ReturnType<typeof createSessionNotices>
  >();
  function sessionsOf(machine: Id<"mch"> | null) {
    let found = sessionNotices.get(machine);
    if (found === undefined) {
      const on = machine === null ? {} : { machine };
      found = createSessionNotices({
        who: (session) => who(machine, session),
        bodyOf: (kind, event) => bodyOf(machine, kind, event),
        looking: (session) => looking({ kind: "session", session, ...on }),
        appSession: async (session) =>
          (await read(machine, "read", workspaceSessionRead, { session }))
            ?.session.opened_by_app != null,
        notify: (notice: SessionNotice) =>
          show({
            ...on,
            kind: notice.kind,
            agent: notice.who.agent,
            workspace: notice.who.title,
            body: notice.body,
            lead: { kind: "avatar", profile: notice.who.profile },
            target: { kind: "session", session: notice.who.session, ...on },
          }),
      });
      sessionNotices.set(machine, found);
    }
    return found;
  }

  // 기계마다 그 기계에 알리는 보고. 보이는 session은 기계마다 달라 보고도 기계마다 짓는다: 이 창들에 focus가 있는지와 그 기계의 session만
  // 싣는다. 이 컴퓨터 말고는 그 기계에 닿아 있을 때만 보낸다(실패는 다음 주기가 메운다).
  const presence = createMachinePresence({
    view(machine) {
      const window = focusedWindow();
      if (window === undefined) return { focused: false, looking: [] };
      const contents = window.webContents.id;
      // 앱 화면(view_session)은 싣지 않는다: 앱 화면이 쥔 session은 앱이 연 것이라 core가 못 본 끝을 세우지 않는다.
      return {
        focused: true,
        looking:
          machine === null
            ? [
                ...visibility.visibleIn(contents),
                ...terminalRefs()
                  .filter((ref) => focus.focused(contents, ref))
                  .map(terminalSessionId),
              ]
            : visibility.visibleIn(contents, machine),
      };
    },
    idleMs: () => powerMonitor.getSystemIdleTime() * 1000,
    send(machine, report) {
      // headless는 사람이 앞에 없다.
      if (ctx.headless.headless) return;
      if (machine === null) {
        void ctx.coreInternal("memory", "presence", "report", report);
        return;
      }
      const row = ctx.machines
        .list()
        .machines.find((one) => one.id === machine);
      if (row?.status !== "connected") return;
      void ctx.machines
        .link(machine as Id<"mch">)
        .call({ resource: "presence", method: "report", body: report });
    },
    every(ms, fn) {
      const timer = setInterval(fn, ms);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  });
  ctx.relay.ready.push(() => presence.report(null));

  ctx.relay.conditions.push({ types: [...SESSION_EVENT_TYPES] });
  ctx.relay.events.push((event) => void sessionsOf(null).event(event));
  // 사람에게 한 알림. 보고 있는 탭이 없으므로 lophn 창에 focus가 있으면 toast, 아니면 OS 알림이다.
  // 놓친 알림은 다시 띄우지 않는다(Inbox 줄이 남는다. 기동 중의 급한 program 기록만 예외로 아래에서 다시 읽는다).
  // 앱이 한 알림은 모두 띄운다. program 기록은 사람이 알아야 하는 종류(ALERT_PROGRAM_KINDS)만 띄운다.
  // 한 번 띄운 행(기계, id, 시각). 같은 key로 바뀐 행은 시각이 달라 다시 띄운다.
  const presented = new Set<string>();
  function presentRow(posted: NoticeRow, machine?: Id<"mch">): void {
    const key = `${machine ?? ""}:${posted.id}:${posted.created_at}`;
    if (presented.has(key)) return;
    presented.add(key);
    const on = machine === undefined ? {} : { machine };
    // 앱 없는 기록(SDK 업데이트 필요)은 누르면 Inbox를 연다. 앱 없는 기록은 ALERT 목록에 든 것만 여기까지 온다.
    present(
      onMachine(
        posted.app === null
          ? posted.title
          : `${posted.app_name ?? "App"} · ${posted.title}`,
        machine,
      ),
      excerpt(posted.body),
      undefined,
      posted.app === null
        ? { kind: "inbox" }
        : { kind: "app", app: posted.app, ...on },
    );
  }
  function alerts(event: {
    type: string;
    payload?: unknown;
  }): NoticeRow | null {
    if (event.type !== "NoticePosted") return null;
    const posted = event.payload as NoticeRow;
    if (posted.read_at !== null) return null;
    if (posted.source === "program" && !ALERT_PROGRAM_KINDS.has(posted.kind)) {
      return null;
    }
    return posted;
  }
  ctx.relay.conditions.push({ types: ["NoticePosted"] });
  ctx.relay.events.push((event) => {
    const posted = alerts(event);
    if (posted !== null) presentRow(posted);
  });
  // core는 기동 일(SDK 판 확인)을 마친 뒤 ready를 내고 shell은 그 뒤에 구독하므로 그 사이의 NoticePosted는 오지 않는다.
  // 붙을 때마다 안 읽은 급한 program 기록을 읽어 아직 띄우지 않은 것만 띄운다.
  ctx.relay.ready.push(() => {
    void read(null, "read", noticesOpen, {}).then((open) => {
      for (const row of open?.notices ?? []) {
        if (
          row.source === "program" &&
          row.read_at === null &&
          STARTUP_PROGRAM_KINDS.has(row.kind)
        ) {
          presentRow(row);
        }
      }
    });
  });

  // 다른 기계마다 같은 조건을 건다(구독자 하나가 그 기계에 거는 전부). 그 기계의 event는 같은 규칙으로 띄우되 알림 글에 그 기계 이름이
  // 붙고 누르면 그 기계의 것을 연다. 기기 event 목록에 없는 event는 그 기계가 보내지 않는다.
  const watched = new Set<string>();
  const reported = new Map<string, boolean>();
  function machinesChanged(list: ReturnType<typeof ctx.machines.list>) {
    presence.machines([null, ...list.machines.map((row) => row.id)]);
    for (const machine of [...watched]) {
      if (list.machines.some((row) => row.id === machine)) continue;
      watched.delete(machine);
      reported.delete(machine);
      ctx.machines.watch(machine as Id<"mch">, NOTICE_WATCHER, []);
    }
    for (const row of list.machines) {
      if (!watched.has(row.id)) {
        watched.add(row.id);
        ctx.machines.watch(row.id, NOTICE_WATCHER, OTHER_MACHINE_CONDITIONS);
      }
      // 다시 붙은 기계에는 보고를 한 번 더 보낸다.
      const connected = row.status === "connected";
      if (connected && reported.get(row.id) !== true) presence.report(row.id);
      reported.set(row.id, connected);
    }
  }
  const stopMachines = ctx.machines.subscribe(machinesChanged);
  machinesChanged(ctx.machines.list());
  // 그 기계가 다시 붙어도(`ready`) 놓친 알림은 다시 띄우지 않는다.
  ctx.machines.onFrame((machine, message) => {
    if (message.kind !== "event") return;
    const event = message.event as {
      type: string;
      session?: string;
      payload?: unknown;
    };
    if (event.type === "NoticePosted") {
      const posted = alerts(event);
      if (posted !== null) presentRow(posted, machine);
    } else if (event.type === "TerminalAgentSignaled") {
      const signal = event.payload as {
        harness: string;
        kind: "waiting" | "finished" | "failed";
        name?: string;
        body?: string;
        terminal: string;
      };
      show({
        machine,
        kind: signal.kind === "waiting" ? "permission" : signal.kind,
        agent:
          signal.name ??
          (signal.harness in HARNESS_ADAPTERS
            ? HARNESS_ADAPTERS[signal.harness as keyof typeof HARNESS_ADAPTERS]
                .label
            : signal.harness),
        body: excerpt(signal.body),
        lead: { kind: "harness", harness: signal.harness },
        target: {
          kind: "terminal",
          terminal_ref: signal.terminal,
          machine,
        },
      });
    } else {
      void sessionsOf(machine).event(event);
    }
  });
  ctx.windowHooks.created.push((window) => {
    window.on("focus", () => presence.changed());
    window.on("blur", () => presence.changed());
  });
  ctx.windowHooks.closed.push(({ contentsId }) => {
    visibility.forget(contentsId);
    viewVisibility.forget(contentsId);
    presence.changed();
  });

  const registry = ctx.overlays.overlayRegistry();
  ctx.ipc.handle(NOTICE_VISIBLE_CHANNEL, (event: IpcEvent, input: unknown) => {
    if (!checkCaller(registry, event).ok) return;
    const parsed = checkInput(noticeVisibleSchema, input);
    if (!parsed.ok) return;
    if ("view_session" in parsed.value) {
      viewVisibility.set(
        event.sender.id,
        parsed.value.view_session,
        parsed.value.visible,
      );
    } else {
      visibility.set(
        event.sender.id,
        parsed.value.session,
        parsed.value.visible,
        parsed.value.machine,
      );
    }
    presence.changed();
  });
  ctx.sessionWindows.reveal = (session) => reveal({ kind: "session", session });
  ctx.ipc.handle(NOTICE_OPEN_CHANNEL, (event: IpcEvent, input: unknown) => {
    if (!checkCaller(registry, event).ok) return;
    const parsed = checkInput(noticeTargetSchema, input);
    if (!parsed.ok) return;
    reveal(parsed.value);
  });

  return {
    show,
    terminalFocusChanged: () => presence.changed(),
    stop() {
      stopMachines();
      for (const machine of watched) {
        ctx.machines.watch(machine as Id<"mch">, NOTICE_WATCHER, []);
      }
      presence.stop();
      ctx.ipc.removeHandler(NOTICE_VISIBLE_CHANNEL);
      ctx.ipc.removeHandler(NOTICE_OPEN_CHANNEL);
    },
  };
}
