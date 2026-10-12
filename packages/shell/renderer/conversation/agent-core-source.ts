// AgentViewSource를 core 통로로 만든다. Agent 탭과 앱 공간의 Agent 칸이 agent 하나(실행 정체와 일하는 자리)마다
// source를 얻는 함수가 `coreAgentViewSourceFactory`다. 응답은 main의 contract client가 route output schema로
// 이미 검사했고, 이 쪽은 route 이름·입력·비교 기준을 맞춰 보내고 값을 화면 값으로 옮긴다.
//
// 읽은 값에서 비교 기준(session의 state_seq, 담당의 revision, 묶음의 created_seq 등)을 매번 새로 읽어 쓰므로
// 화면은 비교 기준을 모른다. 결과를 모르는 호출(통로가 끊김)은 unavailable이다.
import { t } from "@lophn/wording";

import { confirmsWithoutWindow } from "../desktop/lophn-space/things-to-confirm/model.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { newId } from "../desktop/lophn-space/model.ts";
import type { ApprovalChoice } from "./approval-card/model.ts";
import type { GroupAnswer } from "./question-card/model.ts";
import type { SlashEntryView } from "./slash-menu/types.ts";
import type {
  AgentViewSource,
  AgentViewSourceFactory,
  BodyPart,
  RewindChoice,
  SendInput,
  SourceResult,
} from "./agent-source.ts";
import { createRewindPart } from "./agent-core-source-rewind.ts";
import {
  type AgentTarget,
  createEnv,
  latestRun,
  runsOfSession,
} from "./agent-core-source-env.ts";
import { readCommands, readRegistry } from "./agent-core-source-commands.ts";
import {
  type FaceDetails,
  readFace,
  readSessions,
} from "./agent-core-source-face.ts";
import { keyTag, memo } from "./agent-core-source-link.ts";
import { createModelPart } from "./agent-core-source-model.ts";
import { readNotices } from "./agent-core-source-notices.ts";
import { createThreadMemo, readThread } from "./agent-core-source-thread.ts";
import type {
  AssignmentValue,
  GroupValue,
  MessageSnapshot,
  RunValue,
  SessionValue,
} from "./agent-core-source-values.ts";

/** 보호 창을 열 때 main에 보내는 참조. 결정은 그 창에서만 받는다. */
export type ConfirmationRequest =
  | {
    readonly kind: "approval_request";
    readonly approval: string;
    readonly preselect: ApprovalChoice;
  }
  | {
    readonly kind: "question_option_action";
    readonly group: string;
    readonly option_key: string;
  }
  | {
    // 되돌리기(lophn-agent/revert). 대상은 [session, checkpoint(, 끝난 요약 call)]이고 main이 preview를 독립 read한다.
    readonly kind: "owner_decision";
    readonly concern: "lophn-agent/revert";
    readonly decision: "Rewind";
    readonly targets: readonly string[];
    readonly choice: RewindChoice;
  };

/** preload의 보호 창 열기. 열린 창의 id를 주거나 연 이유(code)를 준다. */
export type OpenConfirmation = (
  intent: { request: ConfirmationRequest; parentWindow: string },
) => Promise<unknown>;

/** app.create·apply_settings 선택지를 확인 창 없이 확정하는 main 통로. */
export type ConfirmWithoutWindow = (
  input: { group: string; option_key: string },
) => Promise<{ ok: true } | { ok: false; code: string }>;

export interface AgentCoreDeps {
  /** 지금 시각(ms). */
  readonly now?: () => number;
  /** queue 명령이 이번 일이 끝나기를 기다리는 사이. */
  readonly wait?: (ms: number) => Promise<void>;
  /** 없으면(키가 있고 undefined) 창을 열 수 없다. 키가 없으면 이 창의 preload를 찾는다. */
  readonly openConfirmation?: OpenConfirmation | undefined;
  readonly confirmWithoutWindow?: ConfirmWithoutWindow | undefined;
}

interface ShellBridge {
  openConfirmation?: OpenConfirmation;
  confirmWithoutWindow?: ConfirmWithoutWindow;
}

function shellBridge(): ShellBridge {
  return (globalThis as { lophnShell?: ShellBridge }).lophnShell ?? {};
}

/** 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다. */
const PARENT_WINDOW = "requesting-window";

/** 진행 중 run이 끝나기를 기다리는 간격과 상한(10분). 넘으면 명령을 접수하지 않는다. */
const QUEUE_POLL_MS = 1000;
const QUEUE_POLL_LIMIT = 600;

/** 얼굴(이름·자리 이름·권한 요약)을 기억하는 시간. */
const FACE_TTL_MS = 10_000;

const unavailable: SourceResult<never> = { ok: false, code: "unavailable" };
const done: SourceResult<void> = { ok: true, value: undefined };

const dropValue = <T>(result: SourceResult<T>): SourceResult<void> =>
  result.ok ? done : result;

export function coreAgentViewSourceFactory(
  core: CoreSource,
  deps: AgentCoreDeps = {},
): AgentViewSourceFactory {
  return (target) => createSource(core, deps, target);
}

function createSource(
  core: CoreSource,
  deps: AgentCoreDeps,
  target: AgentTarget,
): AgentViewSource {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const openConfirmation = "openConfirmation" in deps
    ? deps.openConfirmation
    : shellBridge().openConfirmation?.bind(shellBridge());
  const confirmWithoutWindow = "confirmWithoutWindow" in deps
    ? deps.confirmWithoutWindow
    : shellBridge().confirmWithoutWindow?.bind(shellBridge());

  const env = createEnv(core, target, now);
  const { link } = env;
  const faceCache = memo<FaceDetails>(now, FACE_TTL_MS);
  const threadMemo = createThreadMemo();
  const modelPart = createModelPart(env);

  const agentName = async (): Promise<string> => {
    const face = await readFace(env, faceCache);
    return face.ok ? face.value.name : "";
  };

  const readSession = async (
    session: string,
  ): Promise<SourceResult<SessionValue>> => {
    const read = await link.read<{ session: SessionValue }>(
      "sessions",
      "read",
      { session },
    );
    return read.ok ? { ok: true, value: read.value.session } : read;
  };

  /** 읽은 session의 state_seq를 비교 기준으로 한 session command. */
  const onSession = async (
    verb: string,
    session: string,
    input: Record<string, unknown>,
    extra = "",
  ): Promise<SourceResult<void>> => {
    const record = await readSession(session);
    if (!record.ok) return record;
    return dropValue(
      await link.command("sessions", verb, {
        input: { session, ...input },
        compare: { state_seq: record.value.state_seq },
        key: `sessions-${verb}-${session}-${record.value.state_seq}${extra}`,
      }),
    );
  };

  const openWindow = async (
    request: ConfirmationRequest,
  ): Promise<SourceResult<void>> => {
    if (openConfirmation === undefined) return unavailable;
    try {
      const opened = await openConfirmation({
        request,
        parentWindow: PARENT_WINDOW,
      }) as { windowId?: string; code?: string } | undefined;
      return typeof opened?.windowId === "string"
        ? done
        : { ok: false, code: opened?.code ?? "internal" };
    } catch {
      return unavailable;
    }
  };

  const rewindPart = createRewindPart(env, threadMemo, { wait, openWindow });

  /** 담당의 지금 revision과 상태. */
  const readAssignment = async (): Promise<SourceResult<AssignmentValue>> => {
    const read = await link.read<{ assignment: AssignmentValue }>(
      "assignments",
      "read",
      { assignment: target.assignment },
    );
    return read.ok ? { ok: true, value: read.value.assignment } : read;
  };

  /** 멈추거나 회수된 담당은 새 session도 새 입력도 받지 않는다. core를 부르지 않고 거절한다. */
  const readEnabled = async (): Promise<
    SourceResult<AssignmentValue & { state: "enabled" }>
  > => {
    const read = await readAssignment();
    if (!read.ok) return read;
    return read.value.state === "enabled"
      ? { ok: true, value: { ...read.value, state: "enabled" } }
      : { ok: false, code: "conflict" };
  };

  const receive = async (
    session: string,
    message: string,
    key: string,
    text: string,
    mode: "request" | "correction",
    run: string | null,
  ): Promise<SourceResult<void>> => {
    const record = await readSession(session);
    if (!record.ok) return record;
    const assignment = await readEnabled();
    if (!assignment.ok) return assignment;
    return dropValue(
      await link.command("messages", "receive", {
        input: {
          id: message,
          session,
          content: { schema_version: 1, parts: [{ kind: "text", text }] },
          mode,
          ...(run === null ? {} : { run }),
        },
        compare: {
          session_state: "open",
          session_state_seq: record.value.state_seq,
          assignment_revision: assignment.value.revision,
          assignment_state: assignment.value.state,
        },
        key,
      }),
    );
  };

  const latestOf = async (
    session: string,
  ): Promise<SourceResult<RunValue | null>> => {
    const runs = await env.runsOf();
    return runs.ok
      ? { ok: true, value: latestRun(runsOfSession(runs.value, session)) }
      : runs;
  };

  const readGroup = async (
    group: string,
  ): Promise<SourceResult<GroupValue>> => {
    const read = await link.read<{ group: GroupValue }>("questions", "read", {
      group,
    });
    return read.ok ? { ok: true, value: read.value.group } : read;
  };

  const source: AgentViewSource = {
    watch: (listener) => core.subscribe(listener),

    agent: () => readFace(env, faceCache),
    sessions: () => readSessions(env),
    thread: (session) => readThread(env, threadMemo, session, agentName),

    async body(message) {
      const read = await link.read<{
        content: {
          parts: (
            | { kind: "text"; text: string }
            | { kind: "visual"; block: unknown }
          )[];
        };
      }>("messages", "body", { message });
      if (!read.ok) return read;
      // 시각 블록은 받은 값 그대로 넘긴다. 블록 renderer가 그리기 전에 다시 검사하고 문자열을 text node로만
      // 그린다.
      return {
        ok: true,
        value: read.value.content.parts.map((part): BodyPart =>
          part.kind === "text"
            ? { kind: "text", text: part.text }
            : { kind: "visual", block: part.block }
        ),
      };
    },

    async documentTitle(document) {
      const read = await link.read<{ document: { title: string } }>(
        "documents",
        "get",
        { document },
      );
      return read.ok ? { ok: true, value: read.value.document.title } : read;
    },

    notices: (session) => readNotices(env, session),

    model: (session, query) => modelPart.model(session, query),
    chooseModel: (session, model, query) =>
      modelPart.chooseModel(session, model, query),
    setModelOption: (session, axis, value, query) =>
      modelPart.setModelOption(session, axis, value, query),
    toggleFavorite: (session, model, query) =>
      modelPart.toggleFavorite(session, model, query),

    commands: (session, query) => readCommands(env, session, query, agentName),

    async runCommand(session, entry: SlashEntryView, key) {
      if (entry.source === "builtin") {
        return { ok: false, code: "invalid_input" };
      }
      const registry = await readRegistry(env, session);
      if (!registry.ok) return registry;
      const found = registry.value.find((item) =>
        item.name === entry.name && item.source === entry.source
      );
      if (found === undefined) return { ok: false, code: "not_found" };
      // 정한 tool 하나를 실행하는 명령은 renderer가 실행할 길이 없다.
      if (found.action.kind === "tool" || found.action.kind === "builtin") {
        return unavailable;
      }
      const text = found.action.kind === "prompt"
        ? found.action.template
        : t("conversation.body.skill-command-request", {
          skill: found.action.skill_name,
        });

      // 일하는 중의 사용 여부. blocked는 바로 거절하고 queue는 이번 일이 끝나기를 기다린다.
      if (entry.whileRunning !== "run") {
        for (let polls = 0;; polls += 1) {
          const latest = await latestOf(session);
          if (!latest.ok) return latest;
          if (latest.value === null || latest.value.state === "finished") break;
          if (entry.whileRunning === "blocked" || polls >= QUEUE_POLL_LIMIT) {
            return { ok: false, code: "conflict" };
          }
          await wait(QUEUE_POLL_MS);
        }
      }
      return await receive(
        session,
        newId("msg", now()),
        `commands-run-${key}`,
        text,
        "request",
        null,
      );
    },

    async openSession({ id, contexts: _contexts }) {
      if (target.place.kind === "global") {
        return { ok: false, code: "invalid_input" };
      }
      const assignment = await readEnabled();
      if (!assignment.ok) return assignment;
      // 사건을 알린 notification의 seq가 chip에 없어 첫 context는 싣지 않는다.
      const opened = await link.command<{ state_seq: string }>(
        "sessions",
        "open",
        {
          input: {
            id,
            assignment: target.assignment,
            work_place: { kind: target.place.kind, id: target.place.id },
            opening_context: null,
          },
          compare: {
            assignment_revision: assignment.value.revision,
            assignment_state: assignment.value.state,
          },
          key: `sessions-open-${id}`,
        },
      );
      if (!opened.ok) return opened;
      await modelPart.applyPending(id, opened.value.state_seq);
      return done;
    },

    renameSession: async (session, title) =>
      await onSession(
        "rename",
        session,
        { title },
        `-${await keyTag(title)}`,
      ),
    archiveSession: (session) => onSession("archive", session, {}),
    unarchiveSession: (session) => onSession("unarchive", session, {}),
    deleteSession: (session) => onSession("delete", session, {}),

    async forkSession({ id, session, through }) {
      const messages = await link.pages<MessageSnapshot>(
        "messages",
        "list",
        { session },
        "messages",
      );
      if (!messages.ok) return messages;
      const point = through === null
        ? messages.value.at(-1)
        : messages.value.find((item) => item.message.id === through);
      if (point === undefined) return { ok: false, code: "invalid_input" };
      return dropValue(
        await link.command("sessions", "fork", {
          input: { id, source: session, through_seq: point.created_seq },
          compare: {},
          key: `sessions-fork-${id}`,
        }),
      );
    },

    async compactSession(session) {
      const record = await readSession(session);
      if (!record.ok) return record;
      return dropValue(
        await link.command("sessions", "request-compact", {
          input: { session },
          compare: { state: "open", state_seq: record.value.state_seq },
          key: `sessions-request-compact-${session}-${record.value.state_seq}`,
        }),
      );
    },

    send: (input: SendInput) =>
      receive(
        input.session,
        input.id,
        input.key,
        input.text,
        input.mode,
        input.run,
      ),

    async stop(run, key) {
      const read = await link.read<{ run: RunValue }>("runs", "read", { run });
      if (!read.ok) return read;
      return dropValue(
        await link.command("runs", "stop", {
          input: { run, request_key: key, reason: "user_stopped" },
          compare: { state_seq: read.value.run.state_seq },
          key,
        }),
      );
    },

    async answerQuestions({ group, answers }) {
      const read = await readGroup(group);
      if (!read.ok) return read;
      // 고정 action이 있는 선택지를 고른 답은 일반 답 경로가 아니다. app.create·apply_settings는
      // 고르는 것이 결정이라 확인 창 없이 main이 확정하고, 그 밖의 action은 확인 창에서 결정한다.
      const action = actionChoice(read.value, answers);
      if (action !== null) {
        if (confirmsWithoutWindow(action.command)) {
          if (confirmWithoutWindow === undefined) return unavailable;
          try {
            const sent = await confirmWithoutWindow({
              group,
              option_key: action.option,
            });
            return sent.ok ? done : { ok: false, code: sent.code };
          } catch {
            return unavailable;
          }
        }
        return await openWindow({
          kind: "question_option_action",
          group,
          option_key: action.option,
        });
      }
      return dropValue(
        await link.command("questions", "answer", {
          input: { group, created_seq: read.value.created_seq, answers },
          compare: { created_seq: read.value.created_seq },
          key: `questions-answer-${group}-${await keyTag(
            JSON.stringify(answers),
          )}`,
        }),
      );
    },

    async deferQuestions(group) {
      const read = await readGroup(group);
      if (!read.ok) return read;
      return dropValue(
        await link.command("questions", "defer", {
          input: { group, created_seq: read.value.created_seq },
          compare: { created_seq: read.value.created_seq },
          key: `questions-defer-${group}`,
        }),
      );
    },

    // 카드의 단추는 결정이 아니라 confirmation window를 미리 고른 choice로 여는 것이다.
    openApproval: ({ approval, choice }) =>
      openWindow({ kind: "approval_request", approval, preselect: choice }),

    rewindMenu: (session) => rewindPart.menu(session),
    rewindPreview: (session, message, choice) =>
      rewindPart.preview(session, message, choice),
    rewind: (input) => rewindPart.rewind(input),
    undoEdit: (session, edit) => rewindPart.undoEdit(session, edit),
    redoRewind: (session, revert) => rewindPart.redoRewind(session, revert),
  };
  return source;
}

/** 질문 하나짜리 묶음에서 고른 선택지가 고정 action이면 그 선택지와 command. */
function actionChoice(
  group: GroupValue,
  answers: readonly GroupAnswer[],
): { option: string; command: string } | null {
  if (group.questions.length !== 1) return null;
  const only = group.questions[0]!;
  const given = answers.find((entry) => entry.question === only.id);
  if (given === undefined || given.answer.kind !== "option") return null;
  const key = given.answer.option_key;
  const chosen = only.options.find((option) => option.key === key);
  return chosen?.action
    ? { option: key, command: chosen.action.command }
    : null;
}
