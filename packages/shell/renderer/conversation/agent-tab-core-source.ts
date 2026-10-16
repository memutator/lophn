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
  recap,
  removeQueuedMessage,
  retryTurn,
  runCommand,
  sendQueuedNow,
  sendText,
  stopTurnOf,
} from "./agent-tab-core-source-commands.ts";
import { createModelPart } from "./agent-tab-core-source-model.ts";
import {
  createRewindIds,
  previewRewind,
  readRewindPoints,
  rewindSession,
} from "./agent-tab-core-source-rewind.ts";
import {
  archiveSessionOf,
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
  const retryIds = new Map<string, string>();
  const rewindIds = createRewindIds();

  const agentName = async (): Promise<string> => {
    const face = await readFace(env, faceCache);
    return face.ok ? face.value.name : "";
  };

  return {
    agent: () => readFace(env, faceCache),
    sessions: () => readSessions(env, activeTimes),
    thread: (session) => readThread(env, memo, session),
    body: (message) => readBody(env, memo, message),
    envelope: (message) => readEnvelope(env, memo, message),
    callState: (call) => readCallState(env, call),
    questions: (session, toolCall) =>
      readAskedQuestions(env, session, toolCall),

    model: (session, query) => modelPart.model(session, query),
    chooseModel: (session, model, query) =>
      modelPart.chooseModel(session, model, query),
    setModelOption: (session, axis, value, query) =>
      modelPart.setModelOption(session, axis, value, query),
    toggleFavorite: (session, model, query) =>
      modelPart.toggleFavorite(session, model, query),

    commands: (session, query) => readCommands(env, session, query, agentName),
    runCommand: (session, entry, key) => runCommand(env, session, entry, key),
    permissions: () => readPermissions(env),
    recap: () => recap(),

    send: (input) => sendText(env, input),
    sendQueuedNow: (queued) => sendQueuedNow(env, queued),
    removeQueued: (queued) => removeQueuedMessage(env, queued),
    stop: (turn, key) => stopTurnOf(env, turn, key),
    retryTurn: (turn) => retryTurn(env, retryIds, turn),
    answerQuestions: (input) => answerQuestions(env, input),
    decidePermission: (session, request, choice, reason) =>
      decidePermission(env, session, request, choice, reason),
    cancelCall: (call) => cancelCallOf(env, call),

    async openSession(
      { id, contexts: _contexts },
    ): Promise<SourceResult<void>> {
      const opened = await openSession(env, id);
      if (!opened.ok) return opened;
      await modelPart.applyPending(id, opened.value.state_seq);
      return { ok: true, value: undefined };
    },
    renameSession: (session, title) => renameSessionTo(env, session, title),
    archiveSession: (session) => archiveSessionOf(env, session),
    deleteSession: (session) => deleteSessionOf(env, session),
    forkSession: (input) => forkSessionOf(env, input),
    compactSession: (session) => compactSessionOf(env, session),

    rewindPoints: (session) => readRewindPoints(env, session),
    rewindPreview: (session, message) => previewRewind(env, session, message),
    rewind: (session, message, choice) =>
      rewindSession(env, rewindIds, session, message, choice),
  };
}
