// AgentTabSource를 harness-gui 창의 ACP session 하나로 만든다. 대화는 창이 받은 갱신을 접은 `AcpFeed`에서 읽고(snapshot
// 없음), 대화 조작은 IPC로 extension의 handle에 보낸다. lophn session이 아니라서 model·권한·`/` 명령·session 목록·rewind·
// fork·call은 없다: `external`이 화면에 그 칸을 그리지 말라고 알리고, 그래도 불리는 읽기와 쓰기는 unavailable로 답한다.
import type { AcpInput } from "../../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../../protocol/coding-agent/harness-adapter.ts";
import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/places.ts";
import type { HarnessGuiInfo } from "../../ipc/harness-gui.ts";
import { turnChoiceOf } from "../desktop/connection/waiting/decide.ts";
import type { AcpFeed } from "../harness-gui/acp-feed.ts";
import type { AgentFace, AgentTabSource } from "./agent-tab-source.ts";

interface GuiSourceDeps {
  readonly info: HarnessGuiInfo;
  readonly feed: AcpFeed;
  /** 조작을 handle에 준다. 받았으면 true다. */
  readonly input: (input: AcpInput) => Promise<boolean>;
}

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;
const none = () => Promise.resolve(UNAVAILABLE);

export function guiAgentTabSource(deps: GuiSourceDeps): AgentTabSource {
  const { info, feed } = deps;
  const session = feed.session;
  const label = HARNESS_ADAPTERS[info.harness].label;
  const face: AgentFace = {
    agent: LOPHN_AGENT_ID,
    name: label,
    profile: { kind: "initial", text: label.slice(0, 1) },
    place: {
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
    external: true,

    agent: () => Promise.resolve({ ok: true, value: face }),
    // 화면이 목록을 읽어 보므로 비어 있을 뿐 오류가 아니다.
    sessions: () => Promise.resolve({ ok: true, value: [] }),
    acp: (id) =>
      Promise.resolve(
        id === session
          ? { ok: true, value: feed.state() }
          : { ok: false, code: "not_found" },
      ),
    // tool의 입력·출력 본문은 ACP에 없다. 줄은 제목과 상태만 보인다.
    toolCallBody: () => Promise.resolve({ ok: false, code: "not_found" }),
    imageUrl: () => Promise.resolve(null),

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
    decidePermission: (_session, request, choice, reason) =>
      send({
        type: "decide",
        session,
        request,
        choice: turnChoiceOf(choice, reason),
      }),

    // 이 아래는 lophn session의 것이라 이 창에 없다.
    searchMessages: none,
    envelope: none,
    callState: none,
    cancelCall: none,
    model: none,
    chooseModel: none,
    setModelOption: none,
    commands: none,
    runCommand: none,
    permissions: none,
    status: none,
    act: none,
    uploadImage: none,
    openSession: none,
    renameSession: none,
    stopSession: none,
    archiveSession: none,
    changeSkip: none,
    deleteSession: none,
    forkSession: none,
    compactSession: none,
    rewindPoints: none,
    rewindPreview: none,
    rewind: none,
  };
}
