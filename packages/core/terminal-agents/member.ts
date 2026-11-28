// project 터미널의 GUI 탭(harness-gui)을 lophn 팀원 session으로 잇는다. 탭(터미널) 하나가 팀원 하나다.
// - 묶기: 탭의 CLI session id를 알면 같은 project·harness·CLI session의 열린 팀원 session을 잇고(resume한 새 탭), 없으면 새로 연다.
//   CLI session id가 바뀌면(fork, `/new`) 그 session에 새 id를 적는다. 묶음은 core 메모리이고 터미널이 끝나면 푼다(session은 남는다).
// - 받기: 그 팀원의 harness queue에 입력이 있고 탭의 turn이 쉬고 줄 선 것도 turn을 기다리는 메시지도 없을 때만 하나를 꺼내 ledger
//   turn을 열고 ACP `send`로 넣는다. ledger turn은 그 입력의 message id를 가져간 ACP turn에만 묶는다(먼저 열린 사람 turn이 아니다).
//   입력 하나가 turn 하나다. restart 탭이 TUI를 보이는 동안은 handle이 없어 입력이 기다린다.
// - 자격: 묶인 탭의 turn마다(사람이 친 turn도) 그 turn의 자격을 credential file에 쓰고 turn이 끝나면 지운다. 넣은 입력의 turn은 ledger
//   turn의 자격이고, 사람이 친 turn은 ledger turn 없이 자격만 낸다(사람이 친 글은 ledger에 옮기지 않는다).
// - 답: 넣은 입력이 call이고 turn이 끝나면 그 turn의 마지막 agent 글을 ledger turn에 남기고 turn을 닫는다. 답은 core의 자동 답
//   (custom-reply wiring)이 보낸다. agent가 먼저 `lophn call reply`로 답했으면 call이 이미 닫혀 보내지 않는다. 답 글 없이 끝나면
//   (멈춤, 실패, 탭·handle 닫힘, 한도 안에 turn이 열리지 않음) result call을 보낸 쪽에 실패(receiver_ended)로 돌려준다.
import type { Result } from "../../base/mod.ts";
import type {
  AcpState,
  AcpUpdate,
  GuiHarness,
  HarnessLaunchConfig,
} from "../../protocol/acp/mod.ts";
import type { AcpApprovalSubject } from "../../protocol/approvals/gate-call.ts";
import type {
  HarnessRecordPart,
  HarnessRuntime,
} from "../../protocol/lophn-agent/mod.ts";
import { guiSessionId } from "../../protocol/lophn-agent/session-tag.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { WorkflowOrigin } from "../../protocol/workflows/values.ts";
import type { CredentialFiles } from "./credential-file.ts";
import type { TabHandle } from "./gui.ts";

/** 팀원 queue의 맨 앞 입력. `prompt`는 lophn tag로 싼 글이다. */
export type MemberInput = {
  message: string;
  kind: "message" | "call" | "reply" | "reaction" | "notice" | "step";
  // call 입력이면 그 call과 답 방식.
  call: string | null;
  reply: "none" | "result" | "conversation" | null;
  prompt: string;
};

export type MemberTurnEnd =
  | "completed"
  | "stopped"
  | "failed"
  | "closed"
  | "unconfigured";

export type BackgroundSessionInfo = {
  harness: HarnessRuntime;
  agent: string;
  cli_session: string | null;
  fork_from: string | null;
  held: boolean;
};

/** harness wiring이 낸다. ledger와 harness queue에 닿는 쪽이다. */
export type HarnessMembers = {
  /** 그 CLI session의 열린 팀원 session(`taken`에 든 것은 빼고). 없으면 새로 연다. */
  ensure(input: {
    harness: HarnessRuntime;
    project: string;
    cli_session: string;
    taken: ReadonlySet<string>;
  }): Promise<Result<string>>;
  /** 지정한 custom harness agent의 새 GUI 탭 팀원 session을 연다(`external_session_id: null`). */
  openForAgent?(input: {
    harness: HarnessRuntime;
    project: string;
    agent: string;
  }): Promise<Result<string>>;
  /** 묶인 탭이나 background의 CLI session id가 바뀌었다. */
  bind(session: string, cliSession: string): Promise<Result<void>>;
  /** 그 팀원 queue의 맨 앞(꺼내지 않는다). 없거나 그 session이 입력을 받지 않으면 null. */
  next(session: string): Promise<MemberInput | null>;
  /** 그 입력을 꺼내 ledger turn을 연다. */
  start(
    session: string,
    message: string,
  ): Promise<Result<{ turn: string; token: string }>>;
  /** ledger turn 없이 그 session의 turn 자격만 낸다(사람이 탭에서 친 turn). */
  credential(session: string): Promise<Result<{ turn: string; token: string }>>;
  /** ledger turn에 글이나 `harness_tool` 조각 하나를 남긴다. */
  record(
    session: string,
    turn: string,
    part: HarnessRecordPart,
  ): Promise<Result<void>>;
  finish(turn: string, end: MemberTurnEnd): Promise<Result<void>>;
  /** 받은 call 하나를 failed(receiver_ended)로 닫아 보낸 쪽에 돌려준다. 이미 닫혔으면 아무것도 하지 않는다. */
  failCall(session: string, call: string): Promise<Result<void>>;
  /**
   * 열린 GUI 탭 팀원 session의 project, harness, CLI session id(아직 없으면 null), `team spawn`으로 열렸는지, workflow 출처.
   * GUI 탭 팀원이 아니거나 닫혔으면 null.
   */
  describe(session: string): {
    project: string;
    harness: HarnessRuntime;
    cli_session: string | null;
    team: boolean;
    workflow_origin?: WorkflowOrigin | null;
    worktree_id?: string | null;
  } | null;
  /** 열린 background harness session(`harness_gui = 0`)의 정보. 탭 팀원이거나 닫혔으면 null. */
  background?(session: string): BackgroundSessionInfo | null;
  /** queue에 입력이 기다리는 session 목록. */
  waiting?(): readonly string[];
  /** background session이 쓸 cwd. Home은 session 전용 폴더를 만들고, 폴더 없는 project·app은 null. */
  cwd?(session: string): Promise<string | null>;
  /** background session에 주입할 worktree 환경변수(PROJECT_ROOT, WORKTREE_*). */
  env?(session: string): Promise<Readonly<Record<string, string>>>;
  /** background session의 agent 정의에서 launch 설정과 deny 규칙을 읽는다. */
  definition?(
    session: string,
  ): Promise<
    Result<{ harness_config?: HarnessLaunchConfig; deny: readonly string[] }>
  >;
  /**
   * background 실행 중 harness가 권한 승인을 물었을 때 session/agent의 skip과 shell·할당 규칙으로 허용 여부를 판정한다.
   * 없으면 fail-closed로 거절한다.
   */
  approve?(
    session: string,
    subject: AcpApprovalSubject,
  ): Promise<"allow" | { reject: string }>;
  /** 사람이 그 coding session을 목록에서 지웠다. 그 CLI session의 열린 팀원 session을 사람 자격으로 보관한다. 보관한 수다. */
  forget(
    who: AuthenticatedContext,
    input: { project: string; harness: HarnessRuntime; cli_session: string },
  ): Promise<Result<number>>;
  /**
   * 그 session이 아직 끝나지 않은 일을 쥐고 있는지: 답을 기다리는 열린 call(내보낸 `agent_calls`)이 있거나 도는 workflow step을 맡았다.
   * 쥐고 있으면 core가 연 탭도 turn이 끝났다고 닫지 않는다(닫으면 답이 올 때마다 `--resume`으로 다시 띄워야 한다).
   */
  holding?(session: string): boolean;
  /** 그 팀원 queue를 비우고 그 안의 call을 실패로 돌려준다(탭을 열지 못했다). */
  failQueued(session: string): Promise<Result<void>>;
  /** 그 turn의 자격을 끝낸다. */
  end(turn: string): void;
  /** 팀원 queue에 입력이 들어왔다. */
  onQueued(listener: (session: string) => void): () => void;
  /** ledger turn이 끝났다(사람의 Stop 포함). */
  onTurnClosed?(
    listener: (event: { session: string; turn: string }) => void,
  ): () => void;
  /** 사람이 GUI 탭에서 직접 turn을 시작하거나 끝냈다(workflow stall 해제·재감지용). */
  personTurnStarted?(session: string): void;
  personTurnEnded?(
    session: string,
    end: MemberTurnEnd,
    error: string | null,
  ): void;
  onPersonTurn?(
    listener: (
      event:
        | { kind: "started"; session: string }
        | {
            kind: "ended";
            session: string;
            end: MemberTurnEnd;
            error: string | null;
          },
    ) => void,
  ): () => void;
};

export const RUNTIME_OF_GUI: Readonly<Record<GuiHarness, HarnessRuntime>> = {
  claude: "claude-code",
  codex: "codex",
  opencode: "opencode",
  omp: "omp",
  antigravity: "antigravity",
};

export const GUI_OF_RUNTIME = Object.fromEntries(
  Object.entries(RUNTIME_OF_GUI).map(([gui, runtime]) => [runtime, gui]),
) as Readonly<Record<HarnessRuntime, GuiHarness>>;

// core가 연 탭의 CLI가 GUI로 서기를 기다리는 한도. 넘으면 그 팀원을 열지 못한 것으로 보고 기다리던 call을 실패로 돌려준다.
export const OPEN_WAIT_MS = 60_000;

// 넣은 입력이 탭의 turn을 열기를 기다리는 한도. 넘으면 그 입력은 탭에 닿지 않은 것으로 보고 닫는다. 사람의 turn이 도는 동안은 다시 잰다.
export const INJECT_WAIT_MS = 30_000;

// project마다 core가 스스로 연 팀원 터미널 가운데 한꺼번에 일하는 것(GUI를 띄우는 중이거나 turn이 도는 중)의 상한. 사람이 연 탭과 일을 마치고
// 쉬는 탭은 세지 않는다. 넘는 입력은 자리가 날 때까지 줄 서고, 한도 안에 자리가 나지 않으면 실패로 돌려준다.
export const OPENED_PER_PROJECT = 8;

// 상한 때문에 줄 선 팀원이 자리를 기다리는 한도.
export const OPEN_QUEUE_WAIT_MS = 30 * 60_000;

type Turn = {
  // 넣은 입력의 ledger turn과 입력. 사람이 친 turn은 null이다.
  ledger: string | null;
  input: MemberInput | null;
  // 낸 자격(turn id와 token). 아직 못 냈으면 null.
  credential: { turn: string; token: string } | null;
  // 이 입력을 가져간 ACP turn. 아직 모르면 null.
  acp: string | null;
  // 사람 메시지가 연 turn이 이 입력을 가져갔다. 그 turn의 글은 답이 아니다.
  foreign: boolean;
  // 넣은 입력이 turn을 열기를 기다리는 timer를 끈다.
  cancel: (() => void) | null;
};

type Member = {
  terminal: string;
  harness: GuiHarness;
  project: string;
  session: string | null;
  cli: string | null;
  handle: TabHandle | null;
  detach: (() => void) | null;
  // ledger turn을 열었지만 탭이 쉬기를 기다려 아직 넣지 못한 입력.
  ready: Turn | null;
  // 넣은 입력의 turn과 사람이 친 turn. 넣은 입력은 사람 turn 뒤에 줄 설 수 있어 둘을 따로 든다.
  injected: Turn | null;
  typed: Turn | null;
  // credential file에 지금 든 자격의 turn.
  file: Turn | null;
  delivering: boolean;
  // 끝난 ledger turn을 닫는 중이다. 닫기 전에 다음 입력의 turn을 열지 않는다.
  finishing: number;
  // core가 call을 받으려고 연 터미널이다. 할 일이 끝나면 닫는다(팀원·workflow·사람이 손댄 탭은 둔다).
  opened: boolean;
  team: boolean;
  workflow: boolean;
  // 사람이 이 탭에서 turn을 열었거나 터미널에 글을 쳤다.
  touched: boolean;
};

// core가 연 터미널의 GUI를 기다리는 것. 한도가 지나도 터미널이 끝날 때까지 들고 있어 같은 팀원에 둘째 탭을 열지 않는다.
type Pending = {
  session: string;
  project: string;
  timedOut: boolean;
  cancel: () => void;
};

// 상한 때문에 탭을 열지 못해 줄 선 팀원.
type OpenWait = { session: string; project: string; cancel: () => void };

export type GuiMembers = ReturnType<typeof createGuiMembers>;

export function createGuiMembers(deps: {
  members(): HarnessMembers | null;
  files: CredentialFiles | null;
  /** 팀원이 되는 탭이면 그 project id(`prj_…`), 아니면 null. */
  projectOf(terminalRef: string): string | null;
  after(ms: number, run: () => void): () => void;
  /**
   * 그 project에 새 터미널을 열고 `<cli> --gui`(`cli_session`이 있으면 `--resume <id>`)를 친다. 연 터미널 참조다. 탭이 없는 팀원에게 입력이
   * 오면 부른다. `workflow_origin`이 있으면 PTY는 실행 project에 두되 탭은 원 workflow의 workspace·desk에 놓는다.
   */
  openTerminal(input: {
    project: string;
    harness: GuiHarness;
    cli_session: string | null;
    workflow_origin?: WorkflowOrigin | null;
    worktree_id?: string | null;
  }): Promise<Result<string>>;
  /** core가 연 터미널을 닫는다. */
  closeTerminal(terminalRef: string): void;
  /** 터미널과 팀원 session의 묶임이 바뀌어 coding_sessions 목록을 다시 알릴 때 부른다. */
  onChanged?(): void;
  log(message: string): void;
}) {
  const byTerminal = new Map<string, Member>();
  // core가 그 팀원을 위해 연 터미널 → 기다림. 그 터미널의 handle이 열리면 묶는다.
  const pending = new Map<string, Pending>();
  // 터미널을 여는 중인 팀원 → project.
  const opening = new Map<string, string>();
  // 상한에 막혀 자리를 기다리는 팀원. 들어온 순서대로 연다.
  const openQueue: OpenWait[] = [];
  // core가 연 터미널 → project. 끝날 때까지 project마다 상한에 센다.
  const coreOpened = new Map<string, string>();
  let offQueued: (() => void) | null = null;
  // 묶기(ensure·bind)는 모든 탭이 한 줄로 한다. 두 탭이 같은 CLI session을 같은 때 보아도 한 팀원을 둘이 잇지 않는다.
  let chain: Promise<void> = Promise.resolve();

  const bySession = (session: string) =>
    [...byTerminal.values()].find((one) => one.session === session);
  const pendingOf = (session: string) =>
    [...pending.values()].find((one) => one.session === session);

  function listenQueue() {
    if (offQueued !== null) return;
    const members = deps.members();
    if (members === null) return;
    offQueued = members.onQueued((session) => {
      const member = bySession(session);
      if (member !== undefined) void deliver(member);
      else void openFor(session);
    });
  }

  // 탭이 없는 팀원에게 입력이 왔다. 사람이 coding agent를 스스로 띄우게 허락했으면 그 project에 터미널을 열어 CLI session을 이어(없으면
  // 새로) GUI로 띄우고, 그 탭이 서면 묶고 넣는다. project에서 일하는 탭이 상한이면 자리가 날 때까지 줄 서고(`drainOpens`), 허락이 없거나,
  // 열지 못하거나, 한도 안에 GUI가 서지 않거나, 자리가 한도 안에 나지 않으면 기다리던 call을 실패로 돌려준다.
  async function openFor(session: string) {
    const members = deps.members();
    if (members === null || opening.has(session)) return;
    const waiting = pendingOf(session);
    if (waiting !== undefined) {
      if (waiting.timedOut) await members.failQueued(session);
      return;
    }
    if (openQueue.some((one) => one.session === session)) return;
    const info = members.describe(session);
    if (info === null) return;
    if (working(info.project) >= OPENED_PER_PROJECT) {
      deps.log(
        `gui member: ${OPENED_PER_PROJECT} tabs are working in this project, waiting for a free slot`,
      );
      const wait: OpenWait = {
        session,
        project: info.project,
        cancel: () => {},
      };
      wait.cancel = deps.after(OPEN_QUEUE_WAIT_MS, () => {
        const at = openQueue.indexOf(wait);
        if (at < 0) return;
        openQueue.splice(at, 1);
        deps.log("gui member: no tab slot freed up in time, input dropped");
        void members.failQueued(session);
      });
      openQueue.push(wait);
      return;
    }
    opening.set(session, info.project);
    const opened = await deps.openTerminal({
      project: info.project,
      harness: GUI_OF_RUNTIME[info.harness],
      cli_session: info.cli_session,
      ...(info.workflow_origin == null
        ? {}
        : { workflow_origin: info.workflow_origin }),
      ...(info.worktree_id == null ? {} : { worktree_id: info.worktree_id }),
    });
    opening.delete(session);
    if (!opened.ok) {
      deps.log(`gui member: tab not opened: ${opened.error.message}`);
      await members.failQueued(session);
      drainOpens(info.project);
      return;
    }
    const terminal = opened.value;
    coreOpened.set(terminal, info.project);
    const wait: Pending = {
      session,
      project: info.project,
      timedOut: false,
      cancel: () => {},
    };
    wait.cancel = deps.after(OPEN_WAIT_MS, () => {
      if (pending.get(terminal) !== wait) return;
      wait.timedOut = true;
      deps.log("gui member: the opened tab did not start its chat view");
      void members.failQueued(session);
    });
    pending.set(terminal, wait);
    deps.onChanged?.();
  }

  // project에서 일하는 core가 연 탭: 여는 중이거나 GUI를 기다리는 것, 묶인 뒤 입력을 넣으려 하거나 turn이 도는 것.
  function working(project: string): number {
    let count = [...opening.values()].filter((one) => one === project).length;
    count += [...pending.values()].filter(
      (one) => one.project === project,
    ).length;
    for (const member of byTerminal.values()) {
      if (member.project !== project || !coreOpened.has(member.terminal)) {
        continue;
      }
      const phase = member.handle?.state().turn?.phase;
      if (
        member.delivering ||
        member.ready !== null ||
        member.injected !== null ||
        member.typed !== null ||
        member.finishing > 0 ||
        phase === "working" ||
        phase === "waiting"
      ) {
        count += 1;
      }
    }
    return count;
  }

  // 자리가 났다. 줄 선 팀원을 들어온 순서로 연다.
  function drainOpens(project: string) {
    for (;;) {
      if (working(project) >= OPENED_PER_PROJECT) return;
      const at = openQueue.findIndex((one) => one.project === project);
      if (at < 0) return;
      const [next] = openQueue.splice(at, 1);
      next!.cancel();
      const member = bySession(next!.session);
      if (member !== undefined) void deliver(member);
      else void openFor(next!.session);
    }
  }

  // 가장 늦은 사람·받은 메시지가 아직 turn에 들지 않았으면 그 turn이 곧 열린다(adapter가 글을 먼저 올리고 turn을 뒤에 여는 경우).
  function messagePending(state: AcpState): boolean {
    for (let i = state.items.length - 1; i >= 0; i -= 1) {
      const item = state.items[i]!;
      if (item.kind !== "message" || item.actor === "agent") continue;
      return item.turn === null;
    }
    return false;
  }

  function idle(member: Member): boolean {
    const state = member.handle?.state();
    return (
      state !== undefined &&
      state.session !== null &&
      (state.turn === null || state.turn.phase === "ended") &&
      state.queued.length === 0 &&
      !messagePending(state) &&
      member.injected === null &&
      member.typed === null &&
      member.finishing === 0
    );
  }

  function writeFile(member: Member, turn: Turn) {
    if (turn.credential === null) return;
    deps.files?.write(member.terminal, turn.credential.token);
    member.file = turn;
  }

  function clearFile(member: Member, turn: Turn) {
    if (member.file !== turn) return;
    deps.files?.remove(member.terminal);
    member.file = null;
  }

  function sync(member: Member, state: AcpState) {
    const cli = state.session?.cli_session ?? null;
    if (cli === null || cli === member.cli) return;
    member.cli = cli;
    chain = chain.then(async () => {
      const members = deps.members();
      if (members === null || byTerminal.get(member.terminal) !== member) {
        return;
      }
      if (member.session === null) {
        // 다른 탭이 쥐었거나 core가 열어 GUI를 기다리는 팀원은 잇지 않는다.
        const taken = new Set([
          ...[...byTerminal.values()].flatMap((one) =>
            one.session === null ? [] : [one.session],
          ),
          ...[...pending.values()].map((one) => one.session),
        ]);
        const ensured = await members.ensure({
          harness: RUNTIME_OF_GUI[member.harness],
          project: member.project,
          cli_session: cli,
          taken,
        });
        if (!ensured.ok) {
          deps.log(`gui member: not opened: ${ensured.error.message}`);
          member.cli = null;
          return;
        }
        if (byTerminal.get(member.terminal) !== member) return;
        member.session = ensured.value;
        void deliver(member);
        return;
      }
      const bound = await members.bind(member.session, cli);
      if (!bound.ok) deps.log(`gui member: not bound: ${bound.error.message}`);
    });
  }

  // 입력은 하나씩이다. 탭이 쉴 때 하나를 꺼내 ledger turn을 열고, 그 뒤에도 쉬면 ACP `send`로 넣는다. 그 사이 사람이 turn을 열었으면
  // 그 turn이 끝나고 다시 쉴 때 넣는다. ledger turn은 그 입력이 연 ACP turn에만 묶는다(`bindInjected`).
  async function deliver(member: Member): Promise<void> {
    const members = deps.members();
    if (members === null || member.delivering || member.session === null) {
      return;
    }
    if (!idle(member)) return;
    member.delivering = true;
    try {
      if (member.ready === null) {
        const input = await members.next(member.session);
        if (input === null || !idle(member)) return;
        const started = await members.start(member.session, input.message);
        if (!started.ok) {
          deps.log(`gui member: turn not started: ${started.error.message}`);
          return;
        }
        member.ready = {
          ledger: started.value.turn,
          input,
          credential: started.value,
          acp: null,
          foreign: false,
          cancel: null,
        };
      }
      const handle = member.handle;
      const turn = member.ready;
      if (handle === null || turn.input === null || !idle(member)) return;
      member.ready = null;
      member.injected = turn;
      waitForTurn(member, turn);
      handle.input({
        type: "send",
        session: guiSessionId(member.terminal),
        id: turn.input.message,
        key: `lophn:${turn.input.message}`,
        content: [{ type: "text", text: turn.input.prompt }],
        delivery: "next_turn",
      });
      bindInjected(member, handle.state());
    } finally {
      member.delivering = false;
    }
  }

  function waitForTurn(member: Member, turn: Turn) {
    turn.cancel = deps.after(INJECT_WAIT_MS, () => {
      turn.cancel = null;
      if (member.injected !== turn || turn.acp !== null) return;
      const state = member.handle?.state();
      const phase = state?.turn?.phase;
      // 사람의 turn이 돌면 그 뒤에 줄 섰을 수 있다.
      if (phase === "working" || phase === "waiting") {
        waitForTurn(member, turn);
        return;
      }
      // adapter의 줄에 남아 있으면 빼서 나중에 사람 turn으로 돌지 않게 한다.
      const id = turn.input?.message;
      if (
        id !== undefined &&
        member.handle !== null &&
        state?.queued.some((one) => one.id === id) === true
      ) {
        member.handle.input({
          type: "remove_queued",
          session: guiSessionId(member.terminal),
          message: id,
        });
      }
      void endInjected(member, turn, "closed", null);
    });
  }

  // 넣은 입력의 message가 turn에 들었으면 그 turn이 이 입력을 가져갔다. 그 turn의 첫 사람·받은 메시지가 이 입력이면 이 입력의 turn이고
  // (같은 turn을 사람 turn으로 먼저 보았으면 그 자격은 거둔다), 사람 메시지가 연 turn이 가져갔으면(줄에 섞여 묶였다) 그 turn의 글은
  // 답이 아니다.
  function bindInjected(member: Member, state: AcpState) {
    const turn = member.injected;
    if (turn === null || turn.acp !== null || turn.input === null) return;
    const id = turn.input.message;
    const item = state.items.find(
      (one) => one.kind === "message" && one.id === id,
    );
    if (item?.kind !== "message" || item.turn === null) return;
    const acp = item.turn;
    turn.acp = acp;
    turn.cancel?.();
    turn.cancel = null;
    const first = state.items.find(
      (one) =>
        one.kind === "message" && one.actor !== "agent" && one.turn === acp,
    );
    if (first !== undefined && first.id !== id) {
      turn.foreign = true;
      return;
    }
    const typed = member.typed;
    if (typed !== null && typed.acp === acp) {
      member.typed = null;
      clearFile(member, typed);
      if (typed.credential !== null) {
        deps.members()?.end(typed.credential.turn);
      }
    }
    writeFile(member, turn);
  }

  // 사람이 탭에서 친 turn. ledger turn 없이 자격만 낸다.
  async function personTurn(member: Member, turn: Turn) {
    const members = deps.members();
    if (members === null || member.session === null) return;
    members.personTurnStarted?.(member.session);
    const issued = await members.credential(member.session);
    if (!issued.ok) {
      deps.log(`gui member: no credential: ${issued.error.message}`);
      return;
    }
    if (member.typed !== turn) {
      members.end(issued.value.turn);
      return;
    }
    turn.credential = issued.value;
    writeFile(member, turn);
  }

  function endTyped(
    member: Member,
    turn: Turn,
    end: MemberTurnEnd = "completed",
    error: string | null = null,
  ) {
    if (member.typed === turn) member.typed = null;
    member.touched = true;
    clearFile(member, turn);
    const members = deps.members();
    if (turn.credential !== null) members?.end(turn.credential.turn);
    if (member.session !== null) {
      members?.personTurnEnded?.(member.session, end, error);
    }
  }

  // 넣은 입력의 turn이 끝났다. result call을 받은 turn이 completed로 끝나면 그 turn의 마지막 agent 글을 남긴다(core의 자동 답이 보낸다).
  // 답 글 없이 끝났거나(멈춤, 실패, 탭이나 handle이 닫힘, turn이 열리지 않음, 빈 글) 사람 메시지가 연 turn이 가져갔으면 그 turn에서는
  // 아무것도 남기지 않고 call을 보낸 쪽에 실패로 돌려준다(그 turn에서 harness가 `lophn call reply`로 답했으면 call이 이미 닫혀 그대로다).
  async function endInjected(
    member: Member,
    turn: Turn,
    end: MemberTurnEnd,
    state: AcpState | null,
    error: string | null = null,
  ) {
    if (member.injected === turn) member.injected = null;
    if (member.ready === turn) member.ready = null;
    turn.cancel?.();
    turn.cancel = null;
    clearFile(member, turn);
    const members = deps.members();
    if (members === null || turn.ledger === null || member.session === null) {
      return;
    }
    const session = member.session;
    if (turn.credential !== null) members.end(turn.credential.turn);
    const input = turn.input;
    const text =
      end === "completed" &&
      state !== null &&
      turn.acp !== null &&
      !turn.foreign
        ? lastAgentText(state, turn.acp)
        : null;
    member.finishing += 1;
    if (end !== "completed" && input !== null) {
      // 넣은 입력은 이미 queue에서 꺼냈다. 조용히 사라지지 않게 무엇이 왜 못 닿았는지 남긴다(error는 adapter가 credential을 가린 글이다).
      deps.log(
        `gui member: ${input.kind} input ${input.message} ended ${end}${error === null ? "" : `: ${error}`}`,
      );
      if (end === "failed" && error !== null) {
        const kept = await members.record(session, turn.ledger, {
          kind: "text",
          text: `The coding agent failed this turn: ${error}`,
        });
        if (!kept.ok) {
          deps.log(`gui member: failure not kept: ${kept.error.message}`);
        }
      }
    }
    if (text !== null && input?.kind === "call") {
      const recorded = await members.record(session, turn.ledger, {
        kind: "text",
        text,
      });
      if (!recorded.ok) {
        deps.log(`gui member: answer not kept: ${recorded.error.message}`);
      }
    }
    const finished = await members.finish(
      turn.ledger,
      turn.foreign ? "stopped" : end,
    );
    if (!finished.ok) {
      deps.log(`gui member: turn not finished: ${finished.error.message}`);
    }
    if (
      text === null &&
      input?.kind === "call" &&
      input.reply === "result" &&
      input.call !== null
    ) {
      const failed = await members.failCall(session, input.call);
      if (!failed.ok) {
        deps.log(`gui member: call not failed: ${failed.error.message}`);
      }
    }
    member.finishing -= 1;
    await closeIfDone(member);
    void deliver(member);
    drainOpens(member.project);
  }

  // core가 call을 받으려고 연 탭은 할 일이 끝나면 닫는다. 팀원(`team spawn`)과 사람이 손댄 탭은 둔다. session은 남아 다시 열린다.
  async function closeIfDone(member: Member) {
    const members = deps.members();
    if (
      members === null ||
      member.session === null ||
      !member.opened ||
      member.team ||
      member.workflow ||
      member.touched ||
      member.ready !== null ||
      member.injected !== null ||
      member.typed !== null ||
      member.finishing > 0 ||
      members.holding?.(member.session) === true ||
      byTerminal.get(member.terminal) !== member
    ) {
      return;
    }
    if ((await members.next(member.session)) !== null) return;
    deps.closeTerminal(member.terminal);
  }

  function update(member: Member, handle: TabHandle, change: AcpUpdate) {
    const state = handle.state();
    bindInjected(member, state);
    if (change.type === "session_changed" || change.type === "session_reset") {
      sync(member, state);
    } else if (change.type === "turn_started") {
      if (member.injected?.acp !== change.turn && member.typed === null) {
        const typed: Turn = {
          ledger: null,
          input: null,
          credential: null,
          acp: change.turn,
          foreign: false,
          cancel: null,
        };
        member.typed = typed;
        void personTurn(member, typed);
      }
      return;
    } else if (change.type === "turn_ended") {
      const injected = member.injected;
      if (member.typed?.acp === change.turn) {
        endTyped(
          member,
          member.typed,
          change.outcome,
          change.error?.message ?? null,
        );
      }
      if (injected?.acp === change.turn) {
        void endInjected(
          member,
          injected,
          change.outcome,
          state,
          change.error?.message ?? null,
        );
        return;
      }
    }
    void deliver(member);
  }

  function closeTurns(member: Member) {
    if (member.typed !== null) endTyped(member, member.typed, "closed", null);
    for (const turn of [member.injected, member.ready]) {
      if (turn !== null) void endInjected(member, turn, "closed", null);
    }
  }

  return {
    /** 팀원 queue를 듣기 시작한다. 탭이 하나도 없어도 팀원에게 온 입력으로 탭을 열어야 해서 core가 harness wiring 뒤에 부른다. */
    listen: listenQueue,

    /** GUI handle이 열렸다(restart toggle마다 새 handle이다). 팀원이 되는 탭이면 묶는다. */
    opened(handle: TabHandle): void {
      const project = deps.projectOf(handle.terminal);
      if (project === null) return;
      listenQueue();
      let member = byTerminal.get(handle.terminal);
      if (member === undefined) {
        // core가 이 팀원을 위해 연 터미널이면 그 팀원이다(CLI session id를 알면 그 session에 적는다). 그 팀원을 이미 다른 탭이 쥐었으면
        // 사람이 연 탭처럼 CLI session id로 찾는다.
        const wait = pending.get(handle.terminal);
        if (wait !== undefined) {
          pending.delete(handle.terminal);
          wait.cancel();
        }
        const wanted =
          wait !== undefined && bySession(wait.session) === undefined
            ? wait.session
            : null;
        const described =
          wanted !== null ? deps.members()?.describe(wanted) : null;
        member = {
          terminal: handle.terminal,
          harness: handle.harness,
          project,
          session: wanted,
          cli: null,
          handle: null,
          detach: null,
          ready: null,
          injected: null,
          typed: null,
          file: null,
          delivering: false,
          finishing: 0,
          opened: coreOpened.has(handle.terminal),
          team: described?.team === true,
          workflow: described?.workflow_origin != null,
          touched: false,
        };
        byTerminal.set(handle.terminal, member);
        deps.onChanged?.();
      }
      const one = member;
      one.detach?.();
      one.handle = handle;
      one.detach = handle.attach({
        snapshot: (state) => {
          sync(one, state);
          void deliver(one);
        },
        update: (change) => update(one, handle, change),
        closed() {
          if (one.handle !== handle) return;
          one.handle = null;
          one.detach = null;
          // 탭에서 돌던 turn은 handle과 함께 끝났다.
          closeTurns(one);
        },
      });
    },

    /** 사람이 그 터미널에 글을 쳤다. core가 연 탭이어도 닫지 않는다. */
    humanInput(terminalRef: string): void {
      const member = byTerminal.get(terminalRef);
      if (member !== undefined) member.touched = true;
    },

    /**
     * 터미널이 끝났다. 묶음을 푼다(session은 열린 채 남는다). 그 팀원 queue에 입력이 남았으면 다시 열고, core가 연 터미널이 GUI를 띄우기
     * 전에 끝났으면 기다리던 call을 실패로 돌려준다.
     */
    terminalEnded(terminalRef: string): void {
      const freed = coreOpened.get(terminalRef);
      coreOpened.delete(terminalRef);
      if (freed !== undefined) queueMicrotask(() => drainOpens(freed));
      const wait = pending.get(terminalRef);
      if (wait !== undefined) {
        pending.delete(terminalRef);
        wait.cancel();
        if (!wait.timedOut) void deps.members()?.failQueued(wait.session);
      }
      const member = byTerminal.get(terminalRef);
      if (member === undefined) return;
      member.detach?.();
      member.handle = null;
      closeTurns(member);
      byTerminal.delete(terminalRef);
      deps.files?.remove(terminalRef);
      const session = member.session;
      const members = deps.members();
      if (session === null || members === null) return;
      void members.next(session).then((left) => {
        if (left !== null && bySession(session) === undefined) {
          void openFor(session);
        }
      });
    },

    /** 사람이 연 custom harness agent 탭이 GUI로 설 때 이 팀원 session에 묶도록 미리 등록한다(자동 닫기 대상이 아니다). */
    expect(terminalRef: string, session: string, project: string): void {
      pending.set(terminalRef, {
        session,
        project,
        timedOut: false,
        cancel: () => {},
      });
      deps.onChanged?.();
    },

    /** 그 터미널에 묶였거나 GUI 시작을 기다리는 팀원 ledger session id. 없으면 null. */
    sessionOf(terminalRef: string): string | null {
      return (
        byTerminal.get(terminalRef)?.session ??
        pending.get(terminalRef)?.session ??
        null
      );
    },

    /** 묶인 팀원의 지금 모습. 묶인 탭이 없으면 null이다. 상태는 탭의 ACP 상태에서 읽는다(사람의 승인을 기다리면 waiting). */
    live(session: string): {
      state: "running" | "waiting" | "idle" | "unknown";
      title: string | null;
    } | null {
      const member = bySession(session);
      if (member === undefined) return null;
      const state = member.handle?.state();
      if (state === undefined) return { state: "unknown", title: null };
      const phase = state.turn?.phase;
      return {
        state:
          phase === "working"
            ? "running"
            : phase === "waiting"
              ? "waiting"
              : "idle",
        title: state.session?.title ?? null,
      };
    },

    stop(): void {
      offQueued?.();
      offQueued = null;
      for (const wait of pending.values()) wait.cancel();
      pending.clear();
      opening.clear();
      for (const wait of openQueue.splice(0)) wait.cancel();
      coreOpened.clear();
      for (const [ref, member] of [...byTerminal]) {
        member.detach?.();
        member.injected?.cancel?.();
        deps.files?.remove(ref);
      }
      byTerminal.clear();
    },
  };
}

// 그 turn의 마지막 agent 글. 없거나 비면 null이다.
export function lastAgentText(
  state: AcpState,
  turn: string | null,
): string | null {
  const last = state.items
    .filter(
      (item) =>
        item.kind === "message" && item.actor === "agent" && item.turn === turn,
    )
    .at(-1);
  if (last === undefined || last.kind !== "message") return null;
  const text = last.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return text.trim() === "" ? null : text;
}
