// AgentTabSource를 core 통로로 만든다. Agent 탭과 앱 공간의 Agent 칸이 agent 하나(와 일하는 자리)마다 source를 얻는
// 함수가 `coreAgentTabSourceFactory`다. 이 쪽은 route 이름·입력을 맞춰 부르고 값을 화면 값으로 옮긴다. 응답은 main의
// contract client가 route output schema로 이미 검사했다.
//
// 읽기는 모두 snapshot이다(처음, 다시 붙을 때, turn이 끝났을 때 화면이 부른다). 그 사이의 진행은 화면이 agent event를 받아
// 줄로 접으므로 source는 event를 듣지도 polling하지도 않는다. 결과를 모르는 호출(통로가 끊김)은 unavailable이다.
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
  decidePermission,
  readCommands,
  removeQueuedMessage,
  retryTurn,
  runCommand,
  sendQueuedNow,
  sendText,
  stopTurnOf,
} from "./agent-tab-core-source-commands.ts";
import { createImageSource } from "./agent-tab-core-source-images.ts";
import { createModelPart } from "./agent-tab-core-source-model.ts";
import {
  createRewindIds,
  previewRewind,
  readRewindPoints,
  rewindSession,
} from "./agent-tab-core-source-rewind.ts";
import {
  archiveSessionOf,
  changeSkipOf,
  compactSessionOf,
  createActiveTimes,
  createFaceCache,
  deleteSessionOf,
  forkSessionOf,
  openSession,
  readFace,
  readPermissions,
  readSessions,
  renameSessionTo,
} from "./agent-tab-core-source-sessions.ts";
import {
  createThreadMemo,
  readAskedQuestions,
  readBody,
  readEnvelope,
  readThread,
  readToolCallBody,
} from "./agent-tab-core-source-thread.ts";

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
  const memo = createThreadMemo();
  const faceCache = createFaceCache(env);
  const activeTimes = createActiveTimes();
  const modelPart = createModelPart(env);
  const images = createImageSource(core);
  const retryIds = new Map<string, string>();
  const rewindIds = createRewindIds();

  return {
    agent: () => readFace(env, faceCache),
    sessions: () => readSessions(env, activeTimes),
    thread: (session) => readThread(env, memo, session),
    body: (message) => readBody(env, memo, message),
    envelope: (message) => readEnvelope(env, memo, message),
    callState: (call) => readCallState(env, call),
    questions: (session, toolCall) =>
      readAskedQuestions(env, session, toolCall),
    toolCallBody: (toolCall, part) =>
      readToolCallBody(env, memo, toolCall, part),

    model: (session, query) => modelPart.model(session, query),
    chooseModel: (session, model, query) =>
      modelPart.chooseModel(session, model, query),
    setModelOption: (session, axis, value, query) =>
      modelPart.setModelOption(session, axis, value, query),

    commands: (session, query) => readCommands(env, session, query),
    runCommand: (session, entry, argument, key) =>
      runCommand(env, session, entry, argument, key),
    permissions: () => readPermissions(env),

    send: (input) => sendText(env, input),
    uploadImage: (session, image) => images.uploadImage(session, image),
    imageUrl: (session, id) => images.imageUrl(session, id),
    sendQueuedNow: (queued) => sendQueuedNow(env, queued),
    removeQueued: (queued) => removeQueuedMessage(env, queued),
    stop: (turn, key) => stopTurnOf(env, turn, key),
    retryTurn: (turn) => retryTurn(env, retryIds, turn),
    answerQuestions: (input) => answerQuestions(env, input),
    decidePermission: (session, request, choice, reason) =>
      decidePermission(env, session, request, choice, reason),
    cancelCall: (call) => cancelCallOf(env, call),

    async openSession({ id }): Promise<SourceResult<void>> {
      const opened = await openSession(env, id);
      if (!opened.ok) return opened;
      await modelPart.applyPending(id, opened.value.state_seq);
      return { ok: true, value: undefined };
    },
    renameSession: (session, title) => renameSessionTo(env, session, title),
    archiveSession: (session) => archiveSessionOf(env, session),
    changeSkip: (session, skip) => changeSkipOf(env, session, skip),
    deleteSession: (session) => deleteSessionOf(env, session),
    forkSession: (input) => forkSessionOf(env, input),
    compactSession: (session) => compactSessionOf(env, session),

    rewindPoints: (session) => readRewindPoints(env, session),
    rewindPreview: (session, message) => previewRewind(env, session, message),
    rewind: (session, message, choice) =>
      rewindSession(env, rewindIds, session, message, choice),
  };
}
