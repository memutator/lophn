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
import type { AcpState, AcpUpdate } from "../../protocol/acp/mod.ts";
import type { GuiHarness } from "../../protocol/extensions/acp-session.ts";
import type { HarnessRuntime } from "../../protocol/lophn-agent/agent-values.ts";
import { guiSessionId } from "../../protocol/lophn-agent/session-tag.ts";
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

export type MemberTurnEnd = "completed" | "stopped" | "failed" | "closed";

/** harness wiring이 낸다. ledger와 harness queue에 닿는 쪽이다. */
export type HarnessMembers = {
  /** 그 CLI session의 열린 팀원 session(`taken`에 든 것은 빼고). 없으면 새로 연다. */
  ensure(input: {
    harness: HarnessRuntime;
    project: string;
    cli_session: string;
    taken: ReadonlySet<string>;
  }): Promise<Result<string>>;
  /** 묶인 탭의 CLI session id가 바뀌었다. */
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
  /** ledger turn에 agent 글 하나를 남긴다. */
  record(session: string, turn: string, text: string): Promise<Result<void>>;
  finish(turn: string, end: MemberTurnEnd): Promise<Result<void>>;
  /** 받은 call 하나를 failed(receiver_ended)로 닫아 보낸 쪽에 돌려준다. 이미 닫혔으면 아무것도 하지 않는다. */
  failCall(session: string, call: string): Promise<Result<void>>;
  /** 그 turn의 자격을 끝낸다. */
  end(turn: string): void;
  /** 팀원 queue에 입력이 들어왔다. */
  onQueued(listener: (session: string) => void): () => void;
};

export const RUNTIME_OF_GUI: Readonly<Record<GuiHarness, HarnessRuntime>> = {
  claude: "claude-code",
  codex: "codex",
  opencode: "opencode",
  omp: "omp",
  antigravity: "antigravity",
};

// 넣은 입력이 탭의 turn을 열기를 기다리는 한도. 넘으면 그 입력은 탭에 닿지 않은 것으로 보고 닫는다. 사람의 turn이 도는 동안은 다시 잰다.
export const INJECT_WAIT_MS = 30_000;

type Turn = {
  // 넣은 입력의 ledger turn과 입력. 사람이 친 turn은 null이다.
  ledger: string | null;
  input: MemberInput | null;
  // 낸 자격(turn id와 token). 아직 못 냈으면 null.
  credential: { turn: string; token: string } | null;
  // 이 입력을 가져간 ACP turn. 아직 모르면 null.
  acp: string | null;
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
  // 넣은 입력의 turn과 사람이 친 turn. 탭의 turn은 하나씩 돌지만 넣은 입력이 사람 turn 뒤에 줄 설 수 있어 둘을 따로 든다.
  injected: Turn | null;
  typed: Turn | null;
  // credential file에 지금 든 자격의 turn.
  file: Turn | null;
  delivering: boolean;
  // 끝난 ledger turn을 닫는 중이다. 닫기 전에 다음 입력의 turn을 열지 않는다.
  finishing: number;
};

export type GuiMembers = ReturnType<typeof createGuiMembers>;

export function createGuiMembers(deps: {
  members(): HarnessMembers | null;
  files: CredentialFiles | null;
  /** 팀원이 되는 탭이면 그 project id(`prj_…`), 아니면 null. */
  projectOf(terminalRef: string): string | null;
  after(ms: number, run: () => void): () => void;
  log(message: string): void;
}) {
  const byTerminal = new Map<string, Member>();
  let offQueued: (() => void) | null = null;
  // 묶기(ensure·bind)는 모든 탭이 한 줄로 한다. 두 탭이 같은 CLI session을 같은 때 보아도 한 팀원을 둘이 잇지 않는다.
  let chain: Promise<void> = Promise.resolve();

  const bySession = (session: string) =>
    [...byTerminal.values()].find((one) => one.session === session);

  function listenQueue() {
    if (offQueued !== null) return;
    const members = deps.members();
    if (members === null) return;
    offQueued = members.onQueued((session) => {
      const member = bySession(session);
      if (member !== undefined) void deliver(member);
    });
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
        const taken = new Set(
          [...byTerminal.values()].flatMap((one) =>
            one.session === null ? [] : [one.session],
          ),
        );
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

  // 입력은 하나씩이다. 탭이 쉴 때 하나를 꺼내 ledger turn을 열고 ACP `send`로 넣는다. 그 사이 사람이 turn을 열었으면 adapter가 그 뒤에
  // 줄 세운다. ledger turn은 그 입력의 id를 가져간 ACP turn에만 묶는다(`bindInjected`).
  async function deliver(member: Member): Promise<void> {
    const members = deps.members();
    if (members === null || member.delivering || member.session === null) {
      return;
    }
    if (!idle(member)) return;
    member.delivering = true;
    try {
      const input = await members.next(member.session);
      if (input === null || !idle(member)) return;
      const started = await members.start(member.session, input.message);
      if (!started.ok) {
        deps.log(`gui member: turn not started: ${started.error.message}`);
        return;
      }
      const turn: Turn = {
        ledger: started.value.turn,
        input,
        credential: started.value,
        acp: null,
        cancel: null,
      };
      member.injected = turn;
      const handle = member.handle;
      if (handle === null) {
        void endInjected(member, turn, "closed", null);
        return;
      }
      waitForTurn(member, turn);
      handle.input({
        type: "send",
        session: guiSessionId(member.terminal),
        id: input.message,
        key: `lophn:${input.message}`,
        content: [{ type: "text", text: input.prompt }],
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
      const phase = member.handle?.state().turn?.phase;
      // 사람의 turn이 돌면 그 뒤에 줄 섰을 수 있다.
      if (phase === "working" || phase === "waiting") {
        waitForTurn(member, turn);
        return;
      }
      void endInjected(member, turn, "closed", null);
    });
  }

  // 넣은 입력의 message가 turn에 들었으면(바로 열렸거나 줄에서 가져갔다) 그 turn이 이 입력의 turn이다. 같은 turn을 사람 turn으로 먼저
  // 보았으면 그 자격은 거둔다.
  function bindInjected(member: Member, state: AcpState) {
    const turn = member.injected;
    if (turn === null || turn.acp !== null || turn.input === null) return;
    const id = turn.input.message;
    const item = state.items.find(
      (one) => one.kind === "message" && one.id === id,
    );
    if (item?.kind !== "message" || item.turn === null) return;
    turn.acp = item.turn;
    turn.cancel?.();
    turn.cancel = null;
    const typed = member.typed;
    if (typed !== null && typed.acp === turn.acp) {
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

  function endTyped(member: Member, turn: Turn) {
    if (member.typed === turn) member.typed = null;
    clearFile(member, turn);
    if (turn.credential !== null) deps.members()?.end(turn.credential.turn);
  }

  // 넣은 입력의 turn이 끝났다. result call을 받은 turn이 completed로 끝나면 그 turn의 마지막 agent 글을 남긴다(core의 자동 답이 보낸다).
  // 답 글 없이 끝났으면(멈춤, 실패, 탭이나 handle이 닫힘, turn이 열리지 않음, 빈 글) call을 보낸 쪽에 실패로 돌려준다.
  async function endInjected(
    member: Member,
    turn: Turn,
    end: MemberTurnEnd,
    state: AcpState | null,
  ) {
    if (member.injected === turn) member.injected = null;
    turn.cancel?.();
    turn.cancel = null;
    clearFile(member, turn);
    const members = deps.members();
    if (members === null || turn.ledger === null || member.session === null) {
      return;
    }
    if (turn.credential !== null) members.end(turn.credential.turn);
    const input = turn.input;
    const text =
      end === "completed" && state !== null && turn.acp !== null
        ? lastAgentText(state, turn.acp)
        : null;
    member.finishing += 1;
    if (text !== null && input?.kind === "call") {
      const recorded = await members.record(member.session, turn.ledger, text);
      if (!recorded.ok) {
        deps.log(`gui member: answer not kept: ${recorded.error.message}`);
      }
    }
    const finished = await members.finish(turn.ledger, end);
    if (!finished.ok) {
      deps.log(`gui member: turn not finished: ${finished.error.message}`);
    }
    if (
      text === null &&
      input?.kind === "call" &&
      input.reply === "result" &&
      input.call !== null
    ) {
      const failed = await members.failCall(member.session, input.call);
      if (!failed.ok) {
        deps.log(`gui member: call not failed: ${failed.error.message}`);
      }
    }
    member.finishing -= 1;
    void deliver(member);
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
          cancel: null,
        };
        member.typed = typed;
        void personTurn(member, typed);
      }
      return;
    } else if (change.type === "turn_ended") {
      if (member.injected?.acp === change.turn) {
        void endInjected(member, member.injected, change.outcome, state);
        return;
      }
      if (member.typed?.acp === change.turn) endTyped(member, member.typed);
    }
    void deliver(member);
  }

  function closeTurns(member: Member) {
    if (member.typed !== null) endTyped(member, member.typed);
    if (member.injected !== null) {
      void endInjected(member, member.injected, "closed", null);
    }
  }

  return {
    /** GUI handle이 열렸다(restart toggle마다 새 handle이다). 팀원이 되는 탭이면 묶는다. */
    opened(handle: TabHandle): void {
      const project = deps.projectOf(handle.terminal);
      if (project === null) return;
      listenQueue();
      let member = byTerminal.get(handle.terminal);
      if (member === undefined) {
        member = {
          terminal: handle.terminal,
          harness: handle.harness,
          project,
          session: null,
          cli: null,
          handle: null,
          detach: null,
          injected: null,
          typed: null,
          file: null,
          delivering: false,
          finishing: 0,
        };
        byTerminal.set(handle.terminal, member);
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

    /** 터미널이 끝났다. 묶음을 푼다(session은 열린 채 남는다). */
    terminalEnded(terminalRef: string): void {
      const member = byTerminal.get(terminalRef);
      if (member === undefined) return;
      member.detach?.();
      member.handle = null;
      closeTurns(member);
      byTerminal.delete(terminalRef);
      deps.files?.remove(terminalRef);
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
