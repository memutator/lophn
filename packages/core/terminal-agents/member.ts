// project 터미널의 GUI 탭(harness-gui)을 lophn 팀원 session으로 잇는다. 탭(터미널) 하나가 팀원 하나다.
// - 묶기: 탭의 CLI session id를 알면 같은 project·harness·CLI session의 열린 팀원 session을 잇고(resume한 새 탭), 없으면 새로 연다.
//   CLI session id가 바뀌면(fork, `/new`) 그 session에 새 id를 적는다. 묶음은 core 메모리이고 터미널이 끝나면 푼다(session은 남는다).
// - 받기: 그 팀원의 harness queue에 입력이 있고 탭의 turn이 쉬고 줄 선 것이 없을 때만 하나를 꺼내 ledger turn을 열고 ACP `send`로
//   넣는다. 입력 하나가 turn 하나다. restart 탭이 TUI를 보이는 동안은 handle이 없어 입력이 기다린다.
// - 자격: 묶인 탭의 turn마다(사람이 친 turn도) 그 turn의 자격을 credential file에 쓰고 turn이 끝나면 지운다. 넣은 입력의 turn은 ledger
//   turn의 자격이고, 사람이 친 turn은 ledger turn 없이 자격만 낸다(사람이 친 글은 ledger에 옮기지 않는다).
// - 답: 넣은 입력이 call이고 turn이 끝나면 그 turn의 마지막 agent 글을 ledger turn에 남기고 turn을 닫는다. 답은 core의 자동 답
//   (custom-reply wiring)이 보낸다. agent가 먼저 `lophn call reply`로 답했으면 call이 이미 닫혀 보내지 않는다.
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

type Turn = {
  // 넣은 입력의 ledger turn. 사람이 친 turn은 null이다.
  ledger: string | null;
  kind: MemberInput["kind"] | null;
  // 낸 자격의 turn. 아직 못 냈으면 null.
  credential: string | null;
  // ACP turn. 넣은 입력이 아직 turn을 열지 않았으면 null.
  acp: string | null;
};

type Member = {
  terminal: string;
  harness: GuiHarness;
  project: string;
  session: string | null;
  cli: string | null;
  handle: TabHandle | null;
  detach: (() => void) | null;
  turn: Turn | null;
  // ledger turn을 열었지만 아직 탭에 넣지 못한 입력.
  ready: { ledger: string; token: string; input: MemberInput } | null;
  delivering: boolean;
  // 끝난 ledger turn을 닫는 중이다. 닫기 전에 다음 입력의 turn을 열지 않는다.
  finishing: number;
  // ensure·bind를 차례로 한다.
  chain: Promise<void>;
};

export type GuiMembers = ReturnType<typeof createGuiMembers>;

export function createGuiMembers(deps: {
  members(): HarnessMembers | null;
  files: CredentialFiles | null;
  /** 팀원이 되는 탭이면 그 project id(`prj_…`), 아니면 null. */
  projectOf(terminalRef: string): string | null;
  log(message: string): void;
}) {
  const byTerminal = new Map<string, Member>();
  let offQueued: (() => void) | null = null;

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

  function idle(member: Member): boolean {
    const state = member.handle?.state();
    return (
      state !== undefined &&
      state.session !== null &&
      (state.turn === null || state.turn.phase === "ended") &&
      state.queued.length === 0 &&
      member.turn === null &&
      member.finishing === 0
    );
  }

  function sync(member: Member, state: AcpState) {
    const cli = state.session?.cli_session ?? null;
    if (cli === null || cli === member.cli) return;
    member.cli = cli;
    member.chain = member.chain.then(async () => {
      const members = deps.members();
      if (members === null) return;
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

  // 입력은 하나씩이다. ledger turn을 먼저 열고(입력을 꺼낸다) 탭이 쉬면 넣는다. 그 사이 사람이 turn을 열면 그 turn이 끝난 뒤 넣는다.
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
        member.ready = { ...started.value, ledger: started.value.turn, input };
      }
      const handle = member.handle;
      if (handle === null || !idle(member)) return;
      const ready = member.ready;
      member.ready = null;
      deps.files?.write(member.terminal, ready.token);
      member.turn = {
        ledger: ready.ledger,
        kind: ready.input.kind,
        credential: ready.ledger,
        acp: null,
      };
      handle.input({
        type: "send",
        session: guiSessionId(member.terminal),
        id: ready.input.message,
        key: `lophn:${ready.input.message}`,
        content: [{ type: "text", text: ready.input.prompt }],
        delivery: "next_turn",
      });
    } finally {
      member.delivering = false;
    }
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
    if (member.turn !== turn) {
      members.end(issued.value.turn);
      return;
    }
    turn.credential = issued.value.turn;
    deps.files?.write(member.terminal, issued.value.token);
  }

  async function endTurn(
    member: Member,
    turn: Turn,
    end: MemberTurnEnd,
    state: AcpState | null,
  ) {
    if (member.turn === turn) member.turn = null;
    deps.files?.remove(member.terminal);
    const members = deps.members();
    if (members === null) return;
    if (turn.credential !== null) members.end(turn.credential);
    if (turn.ledger !== null && member.session !== null) {
      member.finishing += 1;
      if (end === "completed" && turn.kind === "call" && state !== null) {
        const text = lastAgentText(state, turn.acp);
        if (text !== null) {
          const recorded = await members.record(
            member.session,
            turn.ledger,
            text,
          );
          if (!recorded.ok) {
            deps.log(`gui member: answer not kept: ${recorded.error.message}`);
          }
        }
      }
      const finished = await members.finish(turn.ledger, end);
      member.finishing -= 1;
      if (!finished.ok) {
        deps.log(`gui member: turn not finished: ${finished.error.message}`);
      }
    }
    void deliver(member);
  }

  function update(member: Member, handle: TabHandle, change: AcpUpdate) {
    if (change.type === "session_changed" || change.type === "session_reset") {
      sync(member, handle.state());
      void deliver(member);
    } else if (change.type === "turn_started") {
      const turn = member.turn;
      if (turn !== null && turn.acp === null) turn.acp = change.turn;
      else if (turn === null) {
        const next: Turn = {
          ledger: null,
          kind: null,
          credential: null,
          acp: change.turn,
        };
        member.turn = next;
        void personTurn(member, next);
      }
    } else if (change.type === "turn_ended") {
      const turn = member.turn;
      if (turn !== null && (turn.acp === null || turn.acp === change.turn)) {
        turn.acp = change.turn;
        void endTurn(member, turn, change.outcome, handle.state());
      } else void deliver(member);
    } else if (change.type === "message_taken") {
      // 사람이 줄 세운 메시지가 빠져 줄이 비었을 수 있다.
      void deliver(member);
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
          turn: null,
          ready: null,
          delivering: false,
          finishing: 0,
          chain: Promise.resolve(),
        };
        byTerminal.set(handle.terminal, member);
      }
      const one = member;
      one.detach?.();
      one.handle = handle;
      one.detach = handle.attach({
        snapshot: (state) => sync(one, state),
        update: (change) => update(one, handle, change),
        closed() {
          if (one.handle !== handle) return;
          one.handle = null;
          one.detach = null;
          // 탭에서 도는 turn은 handle과 함께 끝났다. 넣지 못한 입력의 ledger turn도 닫는다(입력은 이미 꺼냈다).
          const turn = one.turn;
          if (turn !== null) void endTurn(one, turn, "closed", null);
          const ready = one.ready;
          one.ready = null;
          if (ready !== null) {
            deps.members()?.end(ready.ledger);
            void deps.members()?.finish(ready.ledger, "closed");
          }
        },
      });
    },

    /** 터미널이 끝났다. 묶음을 푼다(session은 열린 채 남는다). */
    terminalEnded(terminalRef: string): void {
      const member = byTerminal.get(terminalRef);
      if (member === undefined) return;
      member.detach?.();
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
      for (const ref of [...byTerminal.keys()]) {
        byTerminal.get(ref)?.detach?.();
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
