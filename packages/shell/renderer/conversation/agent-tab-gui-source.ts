// AgentTabSource를 harness-gui의 ACP session 하나(터미널 탭의 handle)로 만든다. 대화는 main이 준 snapshot에 갱신을 접은 feed에서
// 읽고, 대화 조작은 IPC로 extension의 handle에 보낸다. 무엇을 할 수 있는지는 ACP 상태의 `session.capabilities`가 말하고
// 화면이 읽는다. 새 ACP 입력(model·mode·명령·rewind·fork·compact·이름)은 `act`로 handle에 간다. lophn session의 것(권한 요약,
// call)은 없어서 unavailable로 답한다. session 목록은 그 CLI의 지난 session이고 id가 CLI session id다.
import type {
  AcpEntry,
  AcpInput,
  AcpItem,
  AcpState,
  AcpToolItem,
} from "../../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../../protocol/coding-agent/harness-adapter.ts";
import { lophnIdOf } from "../../../protocol/lophn-agent/workspaces.ts";
import { harnessVendorOf } from "../parts/vendor-icon/vendor-icon.tsx";
import type {
  HarnessGuiInfo,
  HarnessGuiRewindPreview,
  HarnessGuiSessionEntry,
} from "../../ipc/harness-gui.ts";
import { rewindPointsOf } from "./agent-view-model.ts";
import type { AgentFace, AgentTabSource } from "./agent-tab-source.ts";

interface GuiSourceDeps {
  readonly info: HarnessGuiInfo;
  /**
   * snapshot에 갱신을 접은 값. `session`은 이 화면이 쓰는 session id(`ses_…`)다. `changed`는 snapshot이 상태를 통째로
   * 갈아 끼웠을 때 부른다.
   */
  readonly feed: {
    readonly session: string;
    state(): AcpState;
    changed(listener: () => void): () => void;
  };
  /** 조작을 handle에 준다. 받았으면 true다. */
  readonly input: (input: AcpInput) => Promise<boolean>;
  /** 그 CLI가 이 폴더에서 가진 지난 session. 못 읽으면 빈 배열이다. */
  readonly sessions: () => Promise<readonly HarnessGuiSessionEntry[]>;
  /** 그 사람 메시지로 rewind하면 되돌아갈 file. adapter가 못 주면 null이다. */
  readonly rewindPreview: (
    message: string,
  ) => Promise<HarnessGuiRewindPreview | null>;
  /** 이미지를 탭의 임시 폴더에 쓰고 절대 경로를 받는다. 없으면 이미지를 붙일 수 없다. */
  readonly writeImage?: (image: Blob) => Promise<string | null>;
}

/** 숨긴 구간 안까지 찾는다. */
function toolItemIn(
  items: readonly (AcpItem | AcpEntry)[],
  id: string,
): AcpToolItem | undefined {
  for (const item of items) {
    if (item.kind === "tool" && item.id === id) return item;
    if (item.kind === "hidden") {
      const inner = toolItemIn(item.items, id);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/** 자식 대화의 tool까지 찾는다. */
function toolItemOf(state: AcpState, id: string): AcpToolItem | undefined {
  for (const items of [
    state.items,
    ...Object.values(state.children).map((child) => child.items),
  ]) {
    const found = toolItemIn(items, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;
const none = () => Promise.resolve(UNAVAILABLE);

export function guiAgentTabSource(deps: GuiSourceDeps): AgentTabSource {
  const { info, feed } = deps;
  const session = feed.session;
  const label = HARNESS_ADAPTERS[info.harness].label;
  const vendor = harnessVendorOf(info.harness);
  // harness GUI는 lophn session이 아니라 agent id를 쓰는 곳이 없다. 자리표시로 Home lophn을 둔다(자리가 project라 어떤 lophn session과도 겹치지 않는다).
  const face: AgentFace = {
    agent: lophnIdOf(null),
    name: label,
    profile:
      vendor === undefined
        ? { kind: "initial", text: label.slice(0, 1) }
        : { kind: "vendor", vendor },
    workspace: {
      kind: "project",
      name: info.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? info.cwd,
    },
    permissionSummary: "",
  };
  const send = async (input: AcpInput) =>
    (await deps.input(input))
      ? ({ ok: true, value: undefined } as const)
      : UNAVAILABLE;

  return {
    agent: () => Promise.resolve({ ok: true, value: face }),
    // 머리 session menu의 목록. 바꾸기는 `open_session`이고 id는 CLI session id라 lophn session id(`ses_…`)와 다르다.
    sessions: async () => ({
      ok: true,
      value: (await deps.sessions()).map((one) => ({
        id: one.id,
        title: one.title,
        status: "idle" as const,
        activeAt: one.updated_at ?? new Date(0).toISOString(),
        archived: false,
      })),
    }),
    acp: (id) =>
      Promise.resolve(
        id === session
          ? { ok: true, value: feed.state() }
          : { ok: false, code: "not_found" },
      ),
    // harness가 item에 실은 본문(`body`)을 그대로 읽는다. 칸이 null이면 없다.
    toolCallBody: (id, part) => {
      const body = toolItemOf(feed.state(), id)?.body ?? null;
      const value = body?.[part] ?? null;
      return Promise.resolve(
        body === null || value === null
          ? { ok: false, code: "not_found" }
          : { ok: true, value: { value, truncated: body.truncated } },
      );
    },
    imageUrl: () => Promise.resolve(null),
    // 화면이 붙은 뒤에 snapshot이 오면(창을 다시 load) 화면이 이 feed를 다시 읽는다.
    changed: feed.changed,

    send: (input) =>
      send({
        type: "send",
        session,
        id: input.id,
        key: input.key,
        content: [...input.content],
        delivery: input.delivery,
      }),
    sendQueuedNow: (message) => send({ type: "send_queued", session, message }),
    removeQueued: (message) =>
      send({ type: "remove_queued", session, message }),
    // 글이 아닌 block(링크)은 그대로 실어 보낸다.
    editQueued: (message, text) =>
      send({
        type: "edit_queued",
        session,
        message,
        content: [
          { type: "text", text },
          ...(feed
            .state()
            .queued.find((item) => item.id === message)
            ?.content.filter((block) => block.type !== "text") ?? []),
        ],
      }),
    moveQueued: (message, direction) =>
      send({ type: "move_queued", session, message, direction }),
    stop: (turn, key) => send({ type: "stop", session, turn, key }),
    retryTurn: (turn) => send({ type: "retry", session, turn }),
    answerQuestions: (input) =>
      send({
        type: "answer",
        session,
        tool_call: input.toolCall,
        answers: input.answers.map((one) => ({
          question: one.question,
          status: one.status,
          answer: [...one.answer],
        })),
      }),

    act: async (_session, input) =>
      (await deps.input(input)) ? { ok: true, value: {} } : UNAVAILABLE,
    // CLI는 file 경로로 이미지를 읽는다. 메시지에는 그 file의 링크를 싣는다.
    uploadImage: async (image) => {
      const path = await deps.writeImage?.(image);
      if (path === undefined || path === null) return UNAVAILABLE;
      return {
        ok: true,
        value: {
          block: {
            type: "resource_link",
            uri: `file://${path}`,
            name: path.slice(path.lastIndexOf("/") + 1),
            mimeType: image.type,
          },
        },
      };
    },

    // 시점은 feed에서 읽고, 되돌아갈 file은 adapter에게 묻는다. harness에는 앱 write가 없다.
    rewindPoints: () =>
      Promise.resolve({ ok: true, value: rewindPointsOf(feed.state()) }),
    rewindPreview: async (_session, message) => {
      const preview = await deps.rewindPreview(message);
      return preview === null
        ? UNAVAILABLE
        : {
            ok: true,
            value: {
              files: preview.files.map((file) => ({
                path: file.path,
                skipped: null,
              })),
              apps: [],
            },
          };
    },

    // 이 아래는 lophn session의 것이라 이 화면에 없다.
    searchMessages: none,
    callState: none,
    cancelCall: none,
    permissions: none,
    openSession: none,
    stopSession: none,
    archiveSession: none,
    deleteSession: none,
  };
}
