// 터미널 탭이 없는 harness session(Home·App·Job·custom harness agent)을 상주 ACP adapter(`terminal: null`)로 돌린다.
// - queue 감시: `onQueued` + 기동 후 sweep + 1초 주기 sweep(재시작 replay와 TUI hold 해제를 잡는다).
// - transcript: agent 글(`message_recorded`)과 tool 결과(`tool_ended`)를 모두 ledger에 남겨 Home/App 대화가 그대로 보인다.
// - 안전: 사람 탭이 없는 실행이라 승인·질문은 자동으로 거절/취소하고 이유를 남긴다. deny 규칙을 지키지 못하는 adapter는 띄우지 않는다.
// - 수명: turn이 끝나고 queue가 비면 짧은 linger 뒤 handle을 닫는다. TUI hold 요청 시 유휴 handle은 즉시 내보낸다(evict).
import { canonicalize } from "../../base/canonical-json.ts";
import type {
  AcpState,
  AcpTabHandlers,
  AcpUpdate,
  GuiHarness,
  HarnessCatalogResult,
} from "../../protocol/acp/mod.ts";
import type { AcpApprovalSubject } from "../../protocol/approvals/gate-call.ts";
import { AGENT_CREDENTIAL_FILE_ENV } from "../../protocol/coding-agent/credential-env.ts";
import type { HarnessRecordPart } from "../../protocol/lophn-agent/mod.ts";
import { SESSION_ENV_NAME } from "../../protocol/lophn-agent/session-tag.ts";
import type { AcpHandle } from "./acp.ts";
import type { CredentialFiles } from "./credential-file.ts";
import {
  GUI_OF_RUNTIME,
  type HarnessMembers,
  lastAgentText,
  type MemberInput,
  type MemberTurnEnd,
} from "./member.ts";

export const BACKGROUND_IDLE_MS = 15_000;
export const BACKGROUND_SWEEP_MS = 1_000;
export const BACKGROUND_MAX_CONCURRENT = 8;
export const BACKGROUND_KEY_PREFIX = "bg:";

export type BackgroundMembersDeps = {
  members(): HarnessMembers | null;
  files: CredentialFiles | null;
  handlers(): AcpTabHandlers | null;
  enforcesDeny(harness: GuiHarness): boolean;
  after(ms: number, run: () => void): () => void;
  every(ms: number, run: () => void): () => void;
  onCatalog?(
    harness: GuiHarness,
    cwd: string | undefined,
    result: HarnessCatalogResult,
  ): void;
  idleMs?: number;
  sweepMs?: number;
  maxConcurrent?: number;
  log(message: string): void;
};

type ActiveTurn = {
  ledger: string;
  input: MemberInput;
  credential: { turn: string; token: string };
  acp: string | null;
  texts: number;
  recordedMessages: Set<string>;
  recordedTools: Set<string>;
  closedExternally: boolean;
  shutdown: boolean;
  finishing: boolean;
};

type Runner = {
  session: string;
  harness: GuiHarness;
  cwd: string;
  launchKey: string;
  cli: string | null;
  handle: AcpHandle | null;
  detach: (() => void) | null;
  turn: ActiveTurn | null;
  idleTimer: (() => void) | null;
  opening: boolean;
  closing: boolean;
  startError: string | null;
  lastModels: unknown;
  lastModel: unknown;
  recordChain: Promise<void>;
};

function bgKey(session: string): string {
  return `${BACKGROUND_KEY_PREFIX}${session}`;
}

function sessionOfKey(key: string): string | null {
  return key.startsWith(BACKGROUND_KEY_PREFIX)
    ? key.slice(BACKGROUND_KEY_PREFIX.length)
    : null;
}

function approvalLabel(subject: AcpApprovalSubject): string {
  switch (subject.kind) {
    case "shell":
      return subject.command;
    case "file_read":
      return `read ${subject.path}`;
    case "file_write":
      return `${subject.action} ${subject.path}`;
    case "local_tool":
      return subject.name;
    case "app_tool":
      return `${subject.app}:${subject.tool}`;
    case "mcp_tool":
      return `${subject.server}/${subject.tool}`;
    case "setting":
      return subject.key;
    case "project_command":
      return `${subject.name}: ${subject.command}`;
    case "project_command_definition":
      return `${subject.action} ${subject.after?.name ?? subject.before?.name ?? "project command"}`;
    case "file_change":
      return (
        subject.changes.map((one) => `${one.change} ${one.path}`).join(", ") ||
        "file change"
      );
    case "plan":
      return "plan approval";
  }
}

function extractText(
  blocks: readonly { type: string; text?: string }[],
): string {
  return blocks
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("");
}

export type BackgroundMembers = ReturnType<typeof createBackgroundMembers>;

export function createBackgroundMembers(deps: BackgroundMembersDeps) {
  const idleMs = deps.idleMs ?? BACKGROUND_IDLE_MS;
  const sweepMs = deps.sweepMs ?? BACKGROUND_SWEEP_MS;
  const maxConcurrent = deps.maxConcurrent ?? BACKGROUND_MAX_CONCURRENT;

  const runners = new Map<string, Runner>();
  const pumping = new Set<string>();
  const finishes = new Set<Promise<void>>();

  let started = false;
  let stopping = false;
  let offQueued: (() => void) | null = null;
  let offTurnClosed: (() => void) | null = null;
  let offSweep: (() => void) | null = null;

  function cancelIdle(runner: Runner) {
    runner.idleTimer?.();
    runner.idleTimer = null;
  }

  function closeRunner(runner: Runner) {
    if (runner.closing) return;
    runner.closing = true;
    cancelIdle(runner);
    const handle = runner.handle;
    runner.detach?.();
    runner.detach = null;
    runner.handle = null;
    if (runners.get(runner.session) === runner) {
      runners.delete(runner.session);
    }
    deps.files?.remove(runner.session);
    handle?.close();
  }

  function armIdle(runner: Runner) {
    if (runner.closing || runner.turn !== null || runner.opening || stopping) {
      return;
    }
    cancelIdle(runner);
    runner.idleTimer = deps.after(idleMs, () => {
      runner.idleTimer = null;
      if (runner.turn !== null || runner.opening || runner.closing) return;
      closeRunner(runner);
      // 닫힌 자리로 대기 중인 다른 session이 있으면 깨운다.
      sweep();
    });
  }

  function trackFinish(promise: Promise<void>) {
    finishes.add(promise);
    void promise.finally(() => finishes.delete(promise));
  }

  function enqueueRecord(
    runner: Runner,
    turn: ActiveTurn,
    part: HarnessRecordPart,
  ) {
    runner.recordChain = runner.recordChain.then(async () => {
      if (turn.closedExternally) return;
      const members = deps.members();
      if (members === null) return;
      const recorded = await members.record(runner.session, turn.ledger, part);
      if (!recorded.ok) {
        if (recorded.error.code === "conflict") {
          // 사람이 Stop으로 turn을 닫았다. adapter에도 멈춤을 보낸다.
          turn.closedExternally = true;
          stopAcpTurn(runner, turn);
          return;
        }
        deps.log(
          `background harness: record failed (${runner.session}): ${recorded.error.message}`,
        );
      }
    });
  }

  function stopAcpTurn(runner: Runner, turn: ActiveTurn) {
    deps.files?.remove(runner.session);
    if (runner.handle !== null && turn.acp !== null) {
      runner.handle.input({
        type: "stop",
        session: runner.session,
        turn: turn.acp,
        key: `stop:${turn.ledger}`,
      });
    }
  }

  function syncSession(runner: Runner, state: AcpState) {
    const session = state.session;
    if (session === null) return;
    if (session.cli_session !== null && session.cli_session !== runner.cli) {
      const cli = session.cli_session;
      runner.cli = cli;
      void deps
        .members()
        ?.bind(runner.session, cli)
        .then((bound) => {
          if (bound !== undefined && !bound.ok) {
            deps.log(
              `background harness: bind failed (${runner.session}): ${bound.error.message}`,
            );
          }
        });
    }
    if (
      Array.isArray(session.models) &&
      session.models.length > 0 &&
      (session.models !== runner.lastModels ||
        session.model !== runner.lastModel)
    ) {
      runner.lastModels = session.models;
      runner.lastModel = session.model;
      deps.onCatalog?.(runner.harness, runner.cwd || undefined, {
        models: session.models,
        defaults: {
          model: session.model?.model ?? null,
          options: session.model?.options ?? {},
        },
      });
    }
  }

  async function failBeforeSend(
    members: HarnessMembers,
    session: string,
    turnId: string,
    input: MemberInput,
    end: MemberTurnEnd,
    message: string,
  ) {
    const recorded = await members.record(session, turnId, {
      kind: "text",
      text: message,
    });
    if (!recorded.ok) {
      deps.log(
        `background harness: failure note not recorded (${session}): ${recorded.error.message}`,
      );
    }
    members.end(turnId);
    const finished = await members.finish(turnId, end);
    if (!finished.ok) {
      deps.log(
        `background harness: turn not finished (${session}): ${finished.error.message}`,
      );
    }
    if (
      input.kind === "call" &&
      input.reply === "result" &&
      input.call !== null
    ) {
      await members.failCall(session, input.call);
    }
  }

  async function finishActiveTurn(
    runner: Runner,
    turn: ActiveTurn,
    outcome: "completed" | "stopped" | "failed" | "closed",
    errorMessage: string | null,
    state: AcpState | null,
  ): Promise<void> {
    if (turn.finishing) return;
    turn.finishing = true;
    if (runner.turn === turn) runner.turn = null;
    deps.files?.remove(runner.session);
    const members = deps.members();
    if (members === null) return;
    members.end(turn.credential.turn);

    await runner.recordChain;

    // adapter가 message_recorded 없이 message_added로만 글을 냈을 때의 보완.
    if (
      !turn.closedExternally &&
      !turn.shutdown &&
      outcome === "completed" &&
      turn.texts === 0 &&
      state !== null
    ) {
      const fallback = lastAgentText(state, turn.acp);
      if (fallback !== null) {
        turn.texts += 1;
        await members.record(runner.session, turn.ledger, {
          kind: "text",
          text: fallback,
        });
      }
    }

    let failedCall = false;
    if (!turn.closedExternally) {
      let end: MemberTurnEnd;
      if (turn.shutdown || outcome === "closed") {
        end = "closed";
        failedCall = true;
      } else if (outcome === "failed") {
        if (errorMessage !== null && errorMessage.trim() !== "") {
          await members.record(runner.session, turn.ledger, {
            kind: "text",
            text: `${runner.harness} failed: ${errorMessage}`,
          });
        }
        end = "failed";
        failedCall = true;
      } else if (outcome === "stopped" || turn.texts === 0) {
        end = "stopped";
        failedCall = true;
      } else {
        end = "completed";
      }
      const finished = await members.finish(turn.ledger, end);
      if (!finished.ok && finished.error.code !== "conflict") {
        deps.log(
          `background harness: turn not finished (${runner.session}): ${finished.error.message}`,
        );
      }
    } else {
      failedCall = true;
    }

    if (
      failedCall &&
      turn.input.kind === "call" &&
      turn.input.reply === "result" &&
      turn.input.call !== null
    ) {
      await members.failCall(runner.session, turn.input.call);
    }

    if (!runner.closing && !stopping) {
      const next = await members.next(runner.session);
      if (next !== null) {
        void pump(runner.session);
      } else {
        armIdle(runner);
      }
    }
  }

  function onUpdate(runner: Runner, handle: AcpHandle, change: AcpUpdate) {
    const state = handle.state();
    if (change.type === "session_changed" || change.type === "session_reset") {
      syncSession(runner, state);
      return;
    }
    if (change.type === "approval_opened") {
      const approval = change.approval;
      const members = deps.members();
      const rejectNow = (reason: string) => {
        if (runner.closing || runner.handle !== handle) return;
        handle.input({
          type: "decide",
          session: runner.session,
          request: approval.id,
          choice: { kind: "reject", reason },
        });
        if (runner.turn !== null && !runner.turn.closedExternally) {
          enqueueRecord(runner, runner.turn, {
            kind: "text",
            text: `denied: ${approvalLabel(approval.subject)}`,
          });
        }
      };
      if (members?.approve === undefined) {
        // approve 판정기가 없으면 권한을 넓히지 않고 거절한다.
        rejectNow("no one is watching this background run");
        return;
      }
      void members.approve(runner.session, approval.subject).then(
        (verdict) => {
          if (runner.closing || runner.handle !== handle) return;
          if (verdict === "allow") {
            handle.input({
              type: "decide",
              session: runner.session,
              request: approval.id,
              choice:
                approval.subject.kind === "plan"
                  ? { kind: "mode", mode: approval.subject.modes[0]!.id }
                  : { kind: "once" },
            });
            return;
          }
          rejectNow(verdict.reject);
        },
        () => rejectNow("no one is watching this background run"),
      );
      return;
    }
    if (change.type === "question_asked") {
      handle.input({
        type: "answer",
        session: runner.session,
        tool_call: change.tool_call,
        answers: (change.questions ?? []).map((question) => ({
          question: question.question,
          status: "unanswered" as const,
          answer: [],
        })),
      });
      if (runner.turn !== null && !runner.turn.closedExternally) {
        enqueueRecord(runner, runner.turn, {
          kind: "text",
          text: "denied: agent asked a question during a background run",
        });
      }
      return;
    }

    if (runner.opening && runner.turn === null) {
      if (change.type === "turn_ended" && change.outcome === "failed") {
        runner.startError = change.error?.message ?? "harness failed to start";
      }
      return;
    }

    const turn = runner.turn;
    if (turn === null) return;

    if (change.type === "turn_started") {
      if (turn.acp === null) {
        turn.acp = change.turn;
        if (turn.closedExternally) {
          stopAcpTurn(runner, turn);
        }
      }
      return;
    }

    if (change.type === "message_recorded") {
      if (
        !turn.closedExternally &&
        !turn.recordedMessages.has(change.message)
      ) {
        let text = change.body !== null ? extractText(change.body.content) : "";
        if (text === "") {
          const item = state.items.find(
            (one) => one.kind === "message" && one.id === change.message,
          );
          if (item?.kind === "message") {
            text = extractText(item.content);
          }
        }
        if (text.trim() !== "") {
          turn.recordedMessages.add(change.message);
          turn.texts += 1;
          enqueueRecord(runner, turn, { kind: "text", text });
        }
      }
      return;
    }

    if (change.type === "tool_ended") {
      if (!turn.closedExternally && !turn.recordedTools.has(change.tool_call)) {
        const item = state.items.find(
          (one) => one.kind === "tool" && one.id === change.tool_call,
        );
        if (item?.kind === "tool" && item.by === "agent") {
          turn.recordedTools.add(change.tool_call);
          const status =
            item.state === "ok"
              ? "done"
              : item.state === "running"
                ? "running"
                : "failed";
          enqueueRecord(runner, turn, {
            kind: "harness_tool",
            name: item.tool,
            summary: item.title,
            status,
          });
        }
      }
      return;
    }

    if (change.type === "turn_ended") {
      if (turn.acp === null || turn.acp === change.turn) {
        trackFinish(
          finishActiveTurn(
            runner,
            turn,
            change.outcome,
            change.error?.message ?? null,
            state,
          ),
        );
      }
    }
  }

  function attachHandle(runner: Runner, handle: AcpHandle) {
    runner.detach?.();
    runner.handle = handle;
    runner.detach = handle.attach({
      snapshot: (state) => syncSession(runner, state),
      update: (change) => onUpdate(runner, handle, change),
      closed() {
        if (runner.handle !== handle) return;
        runner.handle = null;
        runner.detach = null;
        cancelIdle(runner);
        if (runners.get(runner.session) === runner) {
          runners.delete(runner.session);
        }
        deps.files?.remove(runner.session);
        if (runner.turn !== null) {
          trackFinish(
            finishActiveTurn(runner, runner.turn, "closed", null, null),
          );
        }
        sweep();
      },
    });
  }

  async function pump(session: string): Promise<void> {
    if (stopping || !started || pumping.has(session)) return;
    const members = deps.members();
    if (members === null) return;
    const info = members.background?.(session) ?? null;
    if (info === null) {
      const stale = runners.get(session);
      if (stale !== undefined && stale.turn === null && !stale.opening) {
        closeRunner(stale);
      }
      return;
    }
    if (info.held) {
      const existing = runners.get(session);
      if (
        existing !== undefined &&
        existing.turn === null &&
        !existing.opening
      ) {
        closeRunner(existing);
      }
      return;
    }

    const existing = runners.get(session);
    if (
      existing !== undefined &&
      (existing.turn !== null || existing.opening)
    ) {
      return;
    }
    if (existing === undefined && runners.size >= maxConcurrent) {
      return;
    }

    pumping.add(session);
    try {
      const input = await members.next(session);
      if (input === null) {
        if (existing !== undefined) armIdle(existing);
        return;
      }

      const begun = await members.start(session, input.message);
      if (!begun.ok) {
        if (begun.error.code !== "conflict") {
          deps.log(
            `background harness: start failed (${session}): ${begun.error.message}`,
          );
        }
        return;
      }
      const { turn: ledgerTurn, token } = begun.value;

      const guiHarness = GUI_OF_RUNTIME[info.harness];
      if (input.prompt.trim() === "") {
        await failBeforeSend(
          members,
          session,
          ledgerTurn,
          input,
          "unconfigured",
          "The message has no text to send to the harness.",
        );
        return;
      }
      if (deps.files === null) {
        await failBeforeSend(
          members,
          session,
          ledgerTurn,
          input,
          "closed",
          "Credential files are unavailable for background harness runs.",
        );
        return;
      }
      const def =
        members.definition !== undefined
          ? await members.definition(session)
          : { ok: true as const, value: { deny: [] as readonly string[] } };
      if (!def.ok) {
        await failBeforeSend(
          members,
          session,
          ledgerTurn,
          input,
          "closed",
          "The agent definition could not be read.",
        );
        return;
      }
      if (def.value.deny.length > 0 && !deps.enforcesDeny(guiHarness)) {
        await failBeforeSend(
          members,
          session,
          ledgerTurn,
          input,
          "unconfigured",
          `${info.harness} cannot keep this agent's deny rules, so it was not started.`,
        );
        return;
      }
      const cwd = members.cwd !== undefined ? await members.cwd(session) : null;
      if (cwd === null) {
        await failBeforeSend(
          members,
          session,
          ledgerTurn,
          input,
          "unconfigured",
          "A harness agent needs a workspace that has a folder (home works too).",
        );
        return;
      }
      const handlers = deps.handlers();
      if (handlers === null) {
        await failBeforeSend(
          members,
          session,
          ledgerTurn,
          input,
          "closed",
          "Harness runtime is not ready yet.",
        );
        return;
      }

      const launchKey = canonicalize(def.value.harness_config ?? null);
      let runner = runners.get(session);
      // 정의의 model/option이 바뀌었으면 기존 유휴 handle을 닫고 새 launch 설정으로 띄운다.
      if (
        runner !== undefined &&
        (runner.handle === null ||
          runner.closing ||
          runner.launchKey !== launchKey)
      ) {
        closeRunner(runner);
        runner = undefined;
      }

      if (runner === undefined) {
        runner = {
          session,
          harness: guiHarness,
          cwd,
          launchKey,
          cli: info.cli_session,
          handle: null,
          detach: null,
          turn: null,
          idleTimer: null,
          opening: true,
          closing: false,
          startError: null,
          lastModels: null,
          lastModel: null,
          recordChain: Promise.resolve(),
        };
        runners.set(session, runner);
        deps.files.write(session, token);
        try {
          await handlers.gui({
            terminal: null,
            key: bgKey(session),
            cwd,
            harness: guiHarness,
            env: {
              [AGENT_CREDENTIAL_FILE_ENV]: deps.files.pathOf(session),
              [SESSION_ENV_NAME]: session,
            },
            ...(info.cli_session !== null
              ? { resume: info.cli_session }
              : info.fork_from !== null
                ? { forkFrom: info.fork_from }
                : {}),
            ...(def.value.harness_config === undefined
              ? {}
              : { launch: def.value.harness_config }),
            member: { deny: def.value.deny },
          });
        } catch (cause) {
          runner.opening = false;
          closeRunner(runner);
          await failBeforeSend(
            members,
            session,
            ledgerTurn,
            input,
            "closed",
            `${guiHarness} failed to start: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
          return;
        }
        runner.opening = false;
        if (stopping || runner.closing) {
          closeRunner(runner);
          await failBeforeSend(
            members,
            session,
            ledgerTurn,
            input,
            "closed",
            "Background harness stopped before starting the turn.",
          );
          return;
        }
        if (runner.startError !== null || runner.handle === null) {
          const message =
            runner.startError ?? "Background harness handle did not open.";
          closeRunner(runner);
          await failBeforeSend(
            members,
            session,
            ledgerTurn,
            input,
            "closed",
            `${guiHarness} failed to start: ${message}`,
          );
          return;
        }
      } else {
        cancelIdle(runner);
        deps.files.write(session, token);
      }

      const handle = runner.handle;
      if (handle === null) {
        await failBeforeSend(
          members,
          session,
          ledgerTurn,
          input,
          "closed",
          "Background harness handle closed before send.",
        );
        return;
      }
      const active: ActiveTurn = {
        ledger: ledgerTurn,
        input,
        credential: { turn: ledgerTurn, token },
        acp: null,
        texts: 0,
        recordedMessages: new Set(),
        recordedTools: new Set(),
        closedExternally: false,
        shutdown: false,
        finishing: false,
      };
      runner.turn = active;
      handle.input({
        type: "send",
        session,
        id: input.message,
        key: `lophn:${input.message}`,
        content: [{ type: "text", text: input.prompt }],
        delivery: "next_turn",
      });
    } finally {
      pumping.delete(session);
    }
  }

  function sweep() {
    if (stopping || !started) return;
    const members = deps.members();
    if (members === null) return;
    // 보관·종료되거나 hold가 걸린 유휴 handle을 정리한다.
    for (const runner of [...runners.values()]) {
      if (runner.turn !== null || runner.opening) continue;
      const info = members.background?.(runner.session) ?? null;
      if (info === null || info.held) {
        closeRunner(runner);
      }
    }
    for (const session of members.waiting?.() ?? []) {
      void pump(session);
    }
  }

  return {
    /** spawner가 준비된 뒤 부른다. queue 구독과 주기 sweep을 시작한다. */
    start(): void {
      if (started || stopping) return;
      started = true;
      const members = deps.members();
      if (members !== null) {
        offQueued = members.onQueued((session) => void pump(session));
        offTurnClosed =
          members.onTurnClosed?.(({ session, turn }) => {
            const runner = runners.get(session);
            if (runner?.turn?.ledger === turn) {
              runner.turn.closedExternally = true;
              stopAcpTurn(runner, runner.turn);
            }
          }) ?? null;
      }
      offSweep = deps.every(sweepMs, sweep);
      sweep();
    },

    /** `createAcp`가 `terminal: null`로 연 background handle을 받는다. */
    opened(handle: AcpHandle): void {
      const session = sessionOfKey(handle.terminal);
      if (session === null) {
        handle.close();
        return;
      }
      const runner = runners.get(session);
      if (runner === undefined || runner.closing) {
        handle.close();
        return;
      }
      attachHandle(runner, handle);
    },

    /** 그 session의 background handle이 살아 있는가(열리는 중·유휴 linger 포함). */
    isAlive(session: string): boolean {
      return runners.has(session);
    },

    /** 유휴 background handle을 즉시 닫아 TUI hold가 바로 열 수 있게 한다. turn이 돌고 있으면 닫지 않는다. */
    evict(session: string): boolean {
      const runner = runners.get(session);
      if (runner === undefined || runner.turn !== null || runner.opening) {
        return false;
      }
      closeRunner(runner);
      return true;
    },

    /** core 종료 시 열린 handle을 모두 닫고 진행 중이던 turn은 target_unavailable로 마친다. */
    async stop(): Promise<void> {
      if (stopping) {
        await Promise.allSettled([...finishes]);
        return;
      }
      stopping = true;
      offQueued?.();
      offQueued = null;
      offTurnClosed?.();
      offTurnClosed = null;
      offSweep?.();
      offSweep = null;

      for (const runner of [...runners.values()]) {
        cancelIdle(runner);
        const active = runner.turn;
        if (active !== null) {
          active.shutdown = true;
          trackFinish(finishActiveTurn(runner, active, "closed", null, null));
        }
        closeRunner(runner);
      }
      await Promise.allSettled([...finishes]);
    },
  };
}
