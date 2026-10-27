// 알림을 어디에 띄울지 정하는 한 곳. 터미널 안 coding agent(tracker)와 lophn Agent session(Bus event)이
// 같은 규칙(notice/rule.ts)으로 이리 온다: 보고 있으면 없음, lophn 창에 focus가 있으면 그 창의 toast,
// 없으면 OS 알림. 누르면 그 탭이 있는 창을 앞으로 가져오고 탭을 고른다. toast를 받는 창은 하나뿐이라
// 창이 여럿이어도 한 번만 뜬다.
import { BrowserWindow, Notification } from "electron";

import { en } from "../../../../design/wording/en.ts";
import {
  NOTICE_OPEN_CHANNEL,
  NOTICE_REVEAL_CHANNEL,
  NOTICE_TOAST_CHANNEL,
  NOTICE_UNSEEN_CHANNEL,
  NOTICE_UNSEEN_GET_CHANNEL,
  NOTICE_VISIBLE_CHANNEL,
  type NoticeTarget,
  noticeTargetSchema,
  noticeVisibleSchema,
  type UnseenSession,
} from "../../../ipc/notice.ts";
import type { AvatarFace, OverlayLead } from "../../../ipc/overlay.ts";
import { TERMINAL_REVEAL_CHANNEL } from "../../../ipc/terminal.ts";
import { sessionSnapshotsList } from "../../../../protocol/events/mod.ts";
import { agentDefinitionRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { agentSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { askRead } from "../../../../protocol/lophn-agent/ask-tool.ts";
import { messageBody } from "../../../../protocol/lophn-agent/messages.ts";
import type { TerminalFocusTable } from "../../terminal/controller.ts";
import { excerpt } from "../../notice/excerpt.ts";
import {
  createSessionNotices,
  routeNotice,
  type SessionEvent,
  type SessionNotice,
  SessionVisibility,
} from "../../notice/rule.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { word } from "../wording.ts";
import type { Registered, ShellContext } from "./context.ts";

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

// 정의를 읽지 못할 때만 쓴다.
const AGENT_LABELS = {
  lophn: "waiting.label.agent-lophn",
  operator: "waiting.label.agent-operator",
  project_manager: "waiting.label.agent-project-manager",
  app_engineer: "waiting.label.agent-app-engineer",
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
  place?: string;
  /** 본문: 마지막 응답의 앞부분, 권한 물음의 요약, 실패 까닭. 없으면 본문이 없다(폴더 이름 같은 것으로 채우지 않는다). */
  body?: string;
  lead?: OverlayLead;
  target: NoticeTarget;
};

// main은 ICU formatter를 묶지 않는다. 제목은 {agent}와 {place}뿐이라 그것만 채운다.
function titleOf(kind: keyof typeof TITLES, agent: string, place?: string) {
  const values: Record<string, string> = { agent, place: place ?? "" };
  const key = place === undefined ? TITLES[kind].plain : TITLES[kind].placed;
  return en[key].replace(
    /\{(agent|place)\}/g,
    (_, name: string) => values[name],
  );
}

export type NoticeWiring = Registered & {
  /** 그 탭이 focus를 가진 lophn 창에 보인다. */
  looking(target: NoticeTarget): boolean;
  /** 알린다. 알렸으면(보고 있지 않았으면) true다. */
  show(notice: Notice): boolean;
};

export function createNoticeWiring(
  ctx: ShellContext,
  focus: TerminalFocusTable,
): NoticeWiring {
  const visibility = new SessionVisibility();
  let serial = 0;

  // focus를 가진 lophn 창. 앱 전용 창 같은 shell 밖의 창은 아니다.
  function focusedWindow(): BrowserWindow | undefined {
    const window = BrowserWindow.getFocusedWindow();
    return window !== null && ctx.windows.has(window) ? window : undefined;
  }

  function looking(target: NoticeTarget): boolean {
    const window = focusedWindow();
    if (window === undefined) return false;
    const contents = window.webContents.id;
    return target.kind === "terminal"
      ? focus.focused(contents, target.terminal_ref)
      : visibility.isVisible(contents, target.session);
  }

  // 알림을 누르면 그 탭을 가진 창을 앞으로 가져오고 탭을 고르라고 알린다.
  // 탭을 가진 창을 모르면 마지막으로 focus를 받은 창이다(detached 창은 건너뛴다).
  function reveal(target: NoticeTarget): void {
    const live = [...ctx.windows].filter((window) => !window.isDestroyed());
    const owner =
      target.kind === "terminal"
        ? focus.contentsOf(target.terminal_ref)
        : visibility.owner(target.session);
    const window =
      live.find((item) => item.webContents.id === owner) ??
      live.filter((item) => !ctx.detached.has(item)).at(-1) ??
      live.at(-1);
    if (window === undefined) {
      ctx.desktop.show();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (target.kind === "terminal") {
      for (const item of live) {
        item.webContents.send(TERMINAL_REVEAL_CHANNEL, {
          terminal_ref: target.terminal_ref,
        });
      }
    } else {
      window.webContents.send(NOTICE_REVEAL_CHANNEL, {
        session: target.session,
      });
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

  function show(notice: Notice): boolean {
    const window = focusedWindow();
    const route = routeNotice({
      looking: looking(notice.target),
      // detached 창에는 toast 표면이 없다.
      toastable: window !== undefined && !ctx.detached.has(window),
    });
    const title = titleOf(notice.kind, notice.agent, notice.place);
    if (route === "toast") {
      serial += 1;
      window!.webContents.send(NOTICE_TOAST_CHANNEL, {
        id: `notice-${serial}`,
        title,
        body: notice.body,
        lead: notice.lead,
        target: notice.target,
      });
    } else if (route === "os") osNotify(title, notice.body, notice.target);
    return route !== "none";
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
  // coding session은 터미널 쪽 tracker가 알려서 건너뛴다.
  async function who(session: string): Promise<UnseenSession | null> {
    const snapshots = await read("read", sessionSnapshotsList, {
      sessions: [session],
    });
    const agent = snapshots?.snapshots[0]?.agent;
    if (
      agent === undefined ||
      agent === null ||
      agent.role === "coding_agent"
    ) {
      return null;
    }
    const [definition, record] = await Promise.all([
      read("read", agentDefinitionRead, { agent }),
      read("read", agentSessionRead, { session }),
    ]);
    const name =
      definition?.effective.name.value ?? word(AGENT_LABELS[agent.role]);
    const profile = definition?.effective.profile.value;
    // 올린 이미지는 renderer만 읽을 주소가 있어 이름 첫 글자로 갈음한다(Agent 화면 머리와 같다).
    const face: AvatarFace =
      profile?.kind === "icon"
        ? { kind: "icon", icon: profile.icon }
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

  function publishUnseen(sessions: UnseenSession[]): void {
    for (const window of ctx.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(NOTICE_UNSEEN_CHANNEL, sessions);
      }
    }
  }

  const sessions = createSessionNotices({
    who,
    bodyOf,
    looking: (session) => looking({ kind: "session", session }),
    notify: (notice: SessionNotice) =>
      show({
        kind: notice.kind,
        agent: notice.who.agent,
        place: notice.who.title,
        body: notice.body,
        lead: { kind: "avatar", profile: notice.who.profile },
        target: { kind: "session", session: notice.who.session },
      }),
    publish: publishUnseen,
  });

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
  ctx.windowHooks.created.push((window) =>
    window.on("focus", () => sessions.recheck()),
  );
  ctx.windowHooks.closed.push(({ contentsId }) =>
    visibility.forget(contentsId),
  );

  const registry = ctx.overlays.overlayRegistry();
  ctx.ipc.handle(NOTICE_VISIBLE_CHANNEL, (event: IpcEvent, input: unknown) => {
    if (!checkCaller(registry, event).ok) return;
    const parsed = checkInput(noticeVisibleSchema, input);
    if (!parsed.ok) return;
    visibility.set(event.sender.id, parsed.value.session, parsed.value.visible);
    if (parsed.value.visible) sessions.recheck();
  });
  ctx.ipc.handle(NOTICE_OPEN_CHANNEL, (event: IpcEvent, input: unknown) => {
    if (!checkCaller(registry, event).ok) return;
    const parsed = checkInput(noticeTargetSchema, input);
    if (parsed.ok) reveal(parsed.value);
  });
  ctx.ipc.handle(NOTICE_UNSEEN_GET_CHANNEL, (event: IpcEvent) =>
    checkCaller(registry, event).ok ? sessions.unseen() : [],
  );

  return {
    looking,
    show,
    stop() {
      ctx.ipc.removeHandler(NOTICE_VISIBLE_CHANNEL);
      ctx.ipc.removeHandler(NOTICE_OPEN_CHANNEL);
      ctx.ipc.removeHandler(NOTICE_UNSEEN_GET_CHANNEL);
    },
  };
}
