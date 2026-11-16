// 알림을 어디에 띄울지 정하는 한 곳. 터미널 안 coding agent(tracker), lophn Agent session(Bus event),
// 사람에게 한 알림(NoticePosted: 앱이 한 것과 program이 남긴 기록)이 같은 규칙(notice/rule.ts)으로 이리 온다: 보고 있으면 없음,
// lophn 창에 focus가 있으면 그 창의 toast, 없으면 OS 알림. 누르면 그 탭(앱 알림은 그 앱 공간)이 있는 창을
// 앞으로 가져오고 고른다. toast를 받는 창은 하나뿐이라 창이 여럿이어도 한 번만 뜬다.
// 무엇을 보고 있는지(창 focus, idle, 보이는 session·터미널)는 core에도 알린다(presence). 못 본 turn 끝(`unseen`)은 core가 든다.
import { BrowserWindow, Notification, powerMonitor } from "electron";

import type {
  Notice as NoticeRow,
  NoticeKind,
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
import { createPresenceReporter } from "../../notice/presence.ts";
import {
  createSessionNotices,
  routeNotice,
  type SessionEvent,
  type SessionNotice,
  SessionVisibility,
  type SessionWho,
} from "../../notice/rule.ts";
import type { TerminalFocusTable } from "../../terminal/controller.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { word } from "../i18n.ts";
import type { Registered, ShellContext } from "./context.ts";
import { openDesktopWindow } from "./desktop-window.ts";

// 띄우는 program 기록: 실패하거나 사람이 가서 볼 일. 켜짐·data migration 적용·lophn 업데이트는 결과가 기록으로 충분하다.
const ALERT_PROGRAM_KINDS: ReadonlySet<NoticeKind> = new Set([
  "release_failed",
  "release_rolled_back",
  "app_unavailable",
  "app_data_restored",
  "sdk_update_needed",
  "session_stopped_by_app",
  "phone_changed",
]);

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
    return target.kind === "terminal"
      ? focus.focused(contents, target.terminal_ref)
      : visibility.isVisible(contents, target.session) ||
          appSessions
            .viewsOf(target.session)
            .some((view) => viewVisibility.isVisible(contents, view));
  }

  // 알림을 누르면 그 탭을 가진 창을 앞으로 가져오고 탭을 고르라고 알린다.
  // 탭을 가진 창을 모르면 마지막으로 focus를 받은 창이다(detached 창은 건너뛴다).
  function reveal(target: NoticeTarget): void {
    const live = [...ctx.windows].filter((window) => !window.isDestroyed());
    const owner =
      target.kind === "terminal"
        ? focus.contentsOf(target.terminal_ref)
        : target.kind === "session"
          ? visibility.owner(target.session)
          : undefined;
    const window =
      live.find((item) => item.webContents.id === owner) ??
      live.filter((item) => !ctx.detached.has(item)).at(-1) ??
      live.at(-1);
    // This computer's notice opens a window of this computer, never a window of another machine (nor the start machine).
    if (window === undefined) {
      openDesktopWindow(ctx);
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (target.kind === "terminal") {
      const project = projectOf(target.terminal_ref);
      if (project === undefined) return;
      for (const item of live) {
        item.webContents.send(TERMINAL_REVEAL_CHANNEL, {
          terminal_ref: target.terminal_ref,
          project,
        });
      }
    } else if (target.kind === "session") {
      window.webContents.send(NOTICE_REVEAL_CHANNEL, {
        session: target.session,
      });
    } else if (target.kind === "app") {
      window.webContents.send(NOTICE_REVEAL_CHANNEL, { app: target.app });
    } else {
      window.webContents.send(NOTICE_REVEAL_CHANNEL, { inbox: true });
    }
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

  function show(notice: Notice): boolean {
    return present(
      titleOf(notice.kind, notice.agent, notice.workspace),
      notice.body,
      notice.lead,
      notice.target,
    );
  }

  // core 읽기 하나. 읽지 못하거나 모양이 다르면 null이다(알림이 안 뜨는 것보다 본문이 비는 쪽이 낫다).
  async function read<T>(
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
    const reply = await ctx.coreInternal(
      kind,
      route.resource,
      route.method,
      input,
    );
    if (!reply.ok) return null;
    const parsed = route.output.safeParse(reply.value);
    return parsed.success ? parsed.data : null;
  }

  // 누구의 어느 session인지. agent 이름·profile은 사람이 바꿀 수 있고 session 이름도 바뀌어서 알릴 때마다 읽는다.
  async function who(session: string): Promise<SessionWho | null> {
    const snapshots = await read("read", sessionSnapshotsList, {
      sessions: [session],
    });
    const agent = snapshots?.snapshots[0]?.agent;
    if (agent === undefined) return null;
    const [definition, record] = await Promise.all([
      read("read", agentRead, { agent }),
      read("read", workspaceSessionRead, { session }),
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
  async function lastAnswer(messages: string[]): Promise<string | undefined> {
    for (const message of messages.toReversed()) {
      const body = await read("read", messageBody, { message });
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
    kind: SessionNotice["kind"],
    event: SessionEvent,
  ): Promise<string | undefined> {
    const payload = event.payload as EventPayload | undefined;
    if (kind === "finished") return await lastAnswer(payload?.messages ?? []);
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
    const asked = await read("memory", askRead, {
      session: event.session,
      tool_call: payload?.tool_call,
    });
    return excerpt(asked?.questions[0].question);
  }

  const sessions = createSessionNotices({
    who,
    bodyOf,
    looking: (session) => looking({ kind: "session", session }),
    appSession: async (session) =>
      (await read("read", workspaceSessionRead, { session }))?.session
        .opened_by_app != null,
    notify: (notice: SessionNotice) =>
      show({
        kind: notice.kind,
        agent: notice.who.agent,
        workspace: notice.who.title,
        body: notice.body,
        lead: { kind: "avatar", profile: notice.who.profile },
        target: { kind: "session", session: notice.who.session },
      }),
  });

  // focus를 가진 lophn 창에 보이는 session과 고른 터미널. 앱 화면(view_session)은 싣지 않는다: 앱 화면이 쥔 session은
  // 앱이 연 것이라 core가 못 본 끝을 세우지 않는다.
  const presence = createPresenceReporter({
    view() {
      const window = focusedWindow();
      if (window === undefined) return { focused: false, looking: [] };
      const contents = window.webContents.id;
      return {
        focused: true,
        looking: [
          ...visibility.visibleIn(contents),
          ...terminalRefs()
            .filter((ref) => focus.focused(contents, ref))
            .map(terminalSessionId),
        ],
      };
    },
    idleMs: () => powerMonitor.getSystemIdleTime() * 1000,
    send(report) {
      // headless는 사람이 앞에 없다.
      if (ctx.headless.headless) return;
      void ctx.coreInternal("memory", "presence", "report", report);
    },
    every(ms, fn) {
      const timer = setInterval(fn, ms);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  });
  ctx.relay.ready.push(() => presence.report());

  ctx.relay.conditions.push({
    types: [
      "TurnStarted",
      "TurnEnded",
      "TurnRequestOpened",
      "QuestionAsked",
      "SessionEnded",
    ],
  });
  ctx.relay.events.push((event) => void sessions.event(event));
  // 사람에게 한 알림. 보고 있는 탭이 없으므로 lophn 창에 focus가 있으면 toast, 아니면 OS 알림이다.
  // 놓친 알림은 다시 띄우지 않는다(Inbox 줄이 남는다). 앱이 한 알림은 모두 띄운다. program 기록은 사람이 알아야 하는
  // 종류만 띄우고 나머지(켜짐, data migration 적용, lophn 업데이트)는 Inbox에만 남긴다.
  ctx.relay.conditions.push({ types: ["NoticePosted"] });
  ctx.relay.events.push((event) => {
    if (event.type !== "NoticePosted") return;
    const posted = event.payload as NoticeRow;
    if (posted.read_at !== null) return;
    if (posted.source === "program" && !ALERT_PROGRAM_KINDS.has(posted.kind)) {
      return;
    }
    // 앱 없는 기록(SDK 업데이트 필요)은 누르면 Inbox를 연다. 앱 없는 기록은 ALERT 목록에 든 것만 여기까지 온다.
    present(
      posted.app === null
        ? posted.title
        : `${posted.app_name ?? "App"} · ${posted.title}`,
      excerpt(posted.body),
      undefined,
      posted.app === null
        ? { kind: "inbox" }
        : { kind: "app", app: posted.app },
    );
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
      presence.stop();
      ctx.ipc.removeHandler(NOTICE_VISIBLE_CHANNEL);
      ctx.ipc.removeHandler(NOTICE_OPEN_CHANNEL);
    },
  };
}
