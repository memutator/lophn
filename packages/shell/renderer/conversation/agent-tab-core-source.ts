// AgentTabSource를 core 통로로 만든다. Agent 탭과 앱 공간의 Agent 칸이 agent 하나(와 일하는 자리)마다 source를 얻는
// 함수가 `coreAgentTabSourceFactory`다. 이 쪽은 route 이름·입력을 맞춰 부르고 값을 화면 값으로 옮긴다. 응답은 main의
// contract client가 route output schema로 이미 검사했다.
//
// 대화 읽기는 ACP snapshot이다(처음, 다시 붙을 때, `reread`가 설 때 화면이 부른다). 그 사이의 진행은 화면이 `AcpUpdated`
// 갱신을 `reduceAcp`로 접으므로 source는 event를 듣지도 polling하지도 않는다. 결과를 모르는 호출(통로가 끊김)은
// unavailable이다.
import { acpDraft, acpSend, acpSnapshot } from "../../../protocol/acp/mod.ts";
import type {
  AgentTabSource,
  AgentTabSourceFactory,
  SourceResult,
} from "./agent-tab-source.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { type AgentTarget, createEnv } from "./agent-tab-core-source-env.ts";
import { cancelCallOf, readCallState } from "./agent-tab-core-source-calls.ts";
import {
  answerQuestions,
  editQueuedMessage,
  moveQueuedMessage,
  removeQueuedMessage,
  retryTurn,
  sendQueuedNow,
  sendContent,
  stopSessionOf,
  stopTurnOf,
} from "./agent-tab-core-source-commands.ts";
import { createImageSource } from "./agent-tab-core-source-images.ts";
import { searchMessages } from "./agent-tab-core-source-search.ts";
import {
  previewRewind,
  readRewindPoints,
} from "./agent-tab-core-source-rewind.ts";
import {
  archiveSessionOf,
  createActiveTimes,
  createFaceCache,
  deleteSessionOf,
  openSession,
  readFace,
  readPermissions,
  readSessions,
} from "./agent-tab-core-source-sessions.ts";
import {
  createBodiesMemo,
  readEnvelope,
  readToolCallBody,
} from "./agent-tab-core-source-bodies.ts";

interface AgentCoreDeps {
  /** 지금 시각(ms). */
  readonly now?: () => number;
}

export function coreAgentTabSourceFactory(
  core: CoreSource,
  deps: AgentCoreDeps = {},
): AgentTabSourceFactory {
  return (target) => createSource(core, deps, target);
}

function createSource(
  core: CoreSource,
  deps: AgentCoreDeps,
  target: AgentTarget,
): AgentTabSource {
  const env = createEnv(core, target, deps.now ?? Date.now);
  const memo = createBodiesMemo();
  const faceCache = createFaceCache(env);
  const activeTimes = createActiveTimes();
  const images = createImageSource(core);

  return {
    agent: () => readFace(env, faceCache),
    sessions: () => readSessions(env, activeTimes),
    searchMessages: (query) => searchMessages(env, query),
    acp: (session) => env.read(acpSnapshot, { session }),
    draft: () =>
      env.read(acpDraft, { agent: env.agent, workspace: env.workspace }),
    envelope: (message) => readEnvelope(env, memo, message),
    callState: (call) => readCallState(env, call),
    toolCallBody: (toolCall, part) =>
      readToolCallBody(env, memo, toolCall, part),

    permissions: () => readPermissions(env),

    act: (_session, input) => env.read(acpSend, input),
    send: (input) => sendContent(env, input),
    uploadImage: (image) => images.uploadImage(image),
    imageUrl: (session, id) => images.imageUrl(session, id),
    sendQueuedNow: (queued) => sendQueuedNow(env, queued),
    removeQueued: (queued) => removeQueuedMessage(env, queued),
    editQueued: (queued, text) => editQueuedMessage(env, queued, text),
    moveQueued: (queued, direction) =>
      moveQueuedMessage(env, queued, direction),
    stop: (turn, key) => stopTurnOf(env, turn, key),
    retryTurn: (turn) => retryTurn(env, turn),
    answerQuestions: (input) => answerQuestions(env, input),
    cancelCall: (call) => cancelCallOf(env, call),

    async openSession({ id }): Promise<SourceResult<void>> {
      const opened = await openSession(env, id);
      return opened.ok ? { ok: true, value: undefined } : opened;
    },
    stopSession: (session) => stopSessionOf(env, session),
    archiveSession: (session) => archiveSessionOf(env, session),
    deleteSession: (session) => deleteSessionOf(env, session),

    rewindPoints: (session) => readRewindPoints(env, session),
    rewindPreview: (session, message) => previewRewind(env, session, message),
  };
}
