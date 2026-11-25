// AgentTabSource를 core 통로로 만든다. Agent 탭과 앱 공간의 Agent 칸이 agent 하나(와 일하는 자리)마다 source를 얻는
// 함수가 `coreAgentTabSourceFactory`다. 이 쪽은 route 이름·입력을 맞춰 부르고 값을 화면 값으로 옮긴다. 응답은 main의
// contract client가 route output schema로 이미 검사했다.
//
// 대화 읽기는 ACP snapshot이다(처음, 다시 붙을 때, `reread`가 설 때 화면이 부른다). 그 사이의 진행은 화면이 `AcpUpdated`
// 갱신을 `reduceAcp`로 접으므로 source는 event를 듣지도 polling하지도 않는다. 결과를 모르는 호출(통로가 끊김)은
// unavailable이다.
import { acpDraft, acpSend, acpSnapshot } from "../../../protocol/acp/mod.ts";
import { providerRead } from "../../../protocol/lophn-agent/providers.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import {
  createBodiesMemo,
  readEnvelope,
  readToolCallBody,
} from "./agent-tab-core-source-bodies.ts";
import { cancelCallOf, readCallState } from "./agent-tab-core-source-calls.ts";
import {
  answerQuestions,
  editQueuedMessage,
  moveQueuedMessage,
  removeQueuedMessage,
  retryTurn,
  sendContent,
  sendQueuedNow,
  stopSessionOf,
  stopTurnOf,
} from "./agent-tab-core-source-commands.ts";
import {
  type AgentTarget,
  createEnv,
  createGate,
  type Env,
  type Gate,
} from "./agent-tab-core-source-env.ts";
import {
  createImageSource,
  type ImageSource,
} from "./agent-tab-core-source-images.ts";
import {
  cancelInputRequest,
  readInputRequest,
} from "./agent-tab-core-source-request.ts";
import {
  previewRewind,
  readRewindPoints,
} from "./agent-tab-core-source-rewind.ts";
import { searchMessages } from "./agent-tab-core-source-search.ts";
import {
  addAllowRuleOf,
  archiveSessionOf,
  createFaceCache,
  deleteSessionOf,
  openSession,
  readFace,
  readPermissions,
  readSessions,
  revokeSessionGrantOf,
  trustLocalToolOf,
  untrustLocalToolOf,
} from "./agent-tab-core-source-sessions.ts";
import type {
  AgentTabSource,
  AgentTabSourceFactory,
  SourceResult,
} from "./agent-tab-source.ts";

interface AgentCoreDeps {
  /** 지금 시각(ms). */
  readonly now?: () => number;
  /** sign_in 입력 요청의 로그인 흐름. desktop 창만 준다. 없으면 source에 로그인이 없다(폰 앱). */
  // `typeof signInInputRequest`로 쓰지 않는다: 그 file은 desktop 창 code까지 끌고 와 폰의 data 층이 type 검사에서 따라간다.
  readonly signIn?: (
    core: CoreSource,
    env: Env,
    input: Parameters<NonNullable<AgentTabSource["signInInputRequest"]>>[0],
  ) => Promise<SourceResult<void>>;
  /** 이미지 올리기와 그림 주소. 없으면 Blob과 blob URL로 한다(desktop 창). blob URL이 없는 폰은 자기 것을 준다. */
  readonly images?: (core: CoreSource) => ImageSource;
  /** 기기 자격으로 부른다(다른 기계의 범위). 기기가 부를 수 없는 route의 칸(session 지우기, 권한 mode)을 두지 않는다. */
  readonly device?: boolean;
}

export function coreAgentTabSourceFactory(
  core: CoreSource,
  deps: AgentCoreDeps = {},
): AgentTabSourceFactory {
  const gate = createGate();
  return (target) => createSource(core, deps, target, gate);
}

function createSource(
  core: CoreSource,
  deps: AgentCoreDeps,
  target: AgentTarget,
  gate: Gate,
): AgentTabSource {
  const env = createEnv(core, target, deps.now ?? Date.now, gate);
  const memo = createBodiesMemo();
  const faceCache = createFaceCache(env);
  const images = (deps.images ?? createImageSource)(core);
  const { signIn } = deps;

  return {
    agent: () => readFace(env, faceCache),
    sessions: () => readSessions(env),
    searchMessages: (query) => searchMessages(env, query),
    acp: (session) => env.read(acpSnapshot, { session }),
    draft: () =>
      env.read(acpDraft, { agent: env.agent, workspace: env.workspace }),
    envelope: (message) => readEnvelope(env, memo, message),
    callState: (call) => readCallState(env, call),
    toolCallBody: (toolCall, part) =>
      readToolCallBody(env, memo, toolCall, part),

    permissions: (session) => readPermissions(env, session),
    revokeSessionGrant: (session, grant) =>
      revokeSessionGrantOf(env, session, grant),
    trustLocalTool: (path, sha256) => trustLocalToolOf(env, path, sha256),
    untrustLocalTool: (path) => untrustLocalToolOf(env, path),
    addAllowRule: (category, pattern) => addAllowRuleOf(env, category, pattern),

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
    providerAuthKind: async (provider) => {
      const read = await env.read(providerRead, { provider });
      return read.ok
        ? { ok: true, value: read.value.provider.credential.kind }
        : read;
    },
    answerQuestions: (input) => answerQuestions(env, input),
    readInputRequest: (input) => readInputRequest(env, input),
    cancelInputRequest: (input) => cancelInputRequest(env, input),
    signInInputRequest:
      signIn === undefined ? undefined : (input) => signIn(core, env, input),
    cancelCall: (call) => cancelCallOf(env, call),

    async openSession({ id }): Promise<SourceResult<void>> {
      const opened = await openSession(env, id);
      return opened.ok ? { ok: true, value: undefined } : opened;
    },
    stopSession: (session) => stopSessionOf(env, session),
    archiveSession: (session, options) =>
      archiveSessionOf(env, session, options),
    ...(deps.device === true
      ? { downgradeOnlyMode: true as const }
      : { deleteSession: (session) => deleteSessionOf(env, session) }),

    rewindPoints: (session) => readRewindPoints(env, session),
    rewindPreview: (session, message) => previewRewind(env, session, message),
  };
}
