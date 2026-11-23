// 탭 key와 core 터미널의 대응. 탭 전환·공간 이동으로 탭 화면이 사라져도 터미널은 core에서 그대로 돌고, 다시 그릴 때 이 대응으로
// 같은 터미널에 붙는다. 앱을 다시 켜면 탭 layout에 남은 터미널 참조(`fields.terminal`)로 아직 살아 있는 터미널에 다시 붙는다.
// 출력·입력은 여기 두지 않는다. 창마다 하나고, core의 runtime event와 coding session 목록을 따라 탭의 agent와 GUI view를 안다.
import {
  type CodingSession,
  codingSessionsList,
} from "../../../protocol/coding-agent/relay.ts";
import type {
  TerminalAgent,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import type { TerminalApi } from "../../ipc/terminal.ts";
import type { TerminalCore } from "./core.ts";
import type { Phase } from "./model.ts";

/** 저장한 coding agent session을 다시 연다. id는 hook이 준 그대로이고 core가 harness의 resume 명령으로 바꿔 친다. */
export type TerminalResume = { harness: string; external_session: string };

export interface TerminalEntry {
  /** 사람이 이 탭에서 터미널을 열었다. 아직 시작 전일 수 있다. */
  readonly requested: boolean;
  readonly folderRef: string | null;
  readonly terminalRef: string | null;
  readonly generation: number;
  readonly phase: Phase;
  /** 처음 여는 한 번만 core가 shell 뒤에 resume 명령을 친다. 열 때 비운다. */
  readonly resume?: TerminalResume;
  /** 처음 여는 한 번만 core가 shell에 넣는 명령(대화 코드 블록의 실행). resume과 같이 열 때 비운다. */
  readonly command?: string;
  /** 처음 여는 한 번만 core가 이 폴더(등록 폴더 안)에서 shell을 연다. 열 때 비운다. */
  readonly cwd?: string;
  /**
   * snapshot을 PTY 치수로 다시 쓴 횟수. 쓴 뒤 view는 PTY 치수라, 탭이 이 값을 보고 칸에 다시 맞춘다(치수가 다르면 PTY도).
   */
  readonly restored?: number;
  /** 폰이 PTY 크기를 잡았다(runtime의 `remote_size`). 탭은 칸에 맞추지 않고 사람이 focus를 주면 다시 잡는다. */
  readonly remote?: boolean;
}

/** 탭의 coding agent. core가 알린 것에 core의 못 본 끝(`unseen`, `term:<탭>`)을 더한 것이다. */
export type TabAgent = TerminalAgent & {
  /** 사람이 그 탭을 보지 않는 사이 turn이 끝났다. */
  readonly unseen: boolean;
};

export class TerminalStore {
  readonly #opening = new Set<string>();
  readonly #entries = new Map<string, TerminalEntry>();
  // 탭 layout에서 읽은 터미널 참조. 탭 화면이 아직 그려지지 않아 항목이 없는 탭의 agent·알림 고르기에 쓴다.
  readonly #remembered = new Map<string, string>();
  // 다른 workspace의 저장된 layout에서 읽은 탭의 터미널 참조. sidebar가 agent를 읽는 데만 쓰고 이 창의 탭으로 치지 않는다.
  readonly #elsewhere = new Map<string, string>();
  readonly #listeners = new Set<() => void>();
  readonly #selectors = new Set<(key: string) => void>();
  readonly #runtimeListeners = new Set<(runtime: TerminalRuntime) => void>();
  // 터미널 안에서 도는 coding agent. 탭 key가 아니라 terminal_ref로 둔다. core의 event가 탭 항목보다
  // 먼저 올 수 있고, 탭을 옮겨도 터미널 참조는 같다.
  readonly #agents = new Map<string, TabAgent>();
  // core가 알린 터미널의 live generation. xterm 탭이 서지 않는 GUI 탭도 focus를 보고하려면 항목 없이 알아야 한다.
  readonly #generations = new Map<string, number>();
  // 터미널마다 coding session(GUI view, handoff, 바꿀 수 있는가).
  #coding = new Map<string, CodingSession>();
  // 못 본 끝이 있는 terminal_ref. 창의 event 연결(EventsProvider)이 넣는다.
  #unseen: ReadonlySet<string> = new Set();
  #version = 0;

  constructor(
    core: TerminalCore | null = null,
    bridge: Pick<TerminalApi, "onReveal"> | null = null,
  ) {
    // store는 창과 함께 살아 해지하지 않는다. 다시 붙으면 목록으로 맞춘다(끊긴 사이의 runtime event는 오지 않는다).
    core?.subscribe((message) => {
      if (message.kind === "ready") {
        void core.list().then((list) => {
          for (const runtime of list ?? []) this.noteRuntime(runtime);
        });
      } else if (
        message.kind === "event" &&
        message.event.type === "TerminalRuntimeChanged"
      ) {
        this.noteRuntime(message.event.payload.runtime);
      }
    });
    // coding session 목록은 붙을 때와 `StateChanged{coding_sessions}`마다 다시 읽는다.
    // core가 막 떠 동시 요청 한도를 넘으면 unavailable이다. 조금 뒤 몇 번 더 읽는다.
    const readCoding = async (left = 3): Promise<void> => {
      const reply = await core!.events.core.call({
        kind: codingSessionsList.kind,
        resource: codingSessionsList.resource,
        method: codingSessionsList.method,
        body: {},
      });
      if (!reply.ok) {
        if (reply.error?.code === "unavailable" && left > 0) {
          setTimeout(() => void readCoding(left - 1), 500);
        }
        return;
      }
      const { sessions } = reply.value as { sessions: CodingSession[] };
      this.#coding = new Map(sessions.map((one) => [one.terminal, one]));
      this.#agentsChanged();
    };
    core?.events.subscribe({ types: ["StateChanged"] }, (message) => {
      if (message.kind === "ready") void readCoding();
      else if (
        message.kind === "event" &&
        message.event.type === "StateChanged" &&
        message.event.payload.changes.some(
          (change) => change.name === "coding_sessions",
        )
      ) {
        void readCoding();
      }
    });
    bridge?.onReveal(({ terminal }) => this.reveal(terminal));
  }

  get(key: string): TerminalEntry | undefined {
    return this.#entries.get(key);
  }

  /** 탭의 터미널 참조. 그려진 탭은 항목의 것, 아직 그리지 않은 탭은 layout에서 읽은 것이다. */
  refOf(key: string): string | null {
    return (
      this.#entries.get(key)?.terminalRef ??
      this.#remembered.get(key) ??
      this.#elsewhere.get(key) ??
      null
    );
  }

  /** layout에서 읽은 탭의 터미널 참조를 기억한다. 탭 화면이 그려질 때 그 터미널이 살아 있으면 붙는다. */
  remember(key: string, terminalRef: string): void {
    if (this.#remembered.get(key) === terminalRef) return;
    this.#remembered.set(key, terminalRef);
    this.#agentsChanged();
  }

  /**
   * 다른 workspace의 저장된 탭의 터미널 참조를 기억한다. 앱을 다시 켠 뒤 이 창이 아직 그리지 않은 workspace의 탭도 core의 살아
   * 있는 터미널과 그 agent를 안다. 이 창의 탭이 아니라 hook 물음과 알림 고르기(`has`, `reveal`)에는 들지 않는다.
   */
  rememberElsewhere(key: string, terminalRef: string): void {
    if (this.#elsewhere.get(key) === terminalRef) return;
    this.#elsewhere.set(key, terminalRef);
    this.#agentsChanged();
  }

  beginOpen(key: string): boolean {
    if (this.#opening.has(key)) return false;
    this.#opening.add(key);
    return true;
  }

  endOpen(key: string): void {
    this.#opening.delete(key);
  }

  /** 탭 터미널의 generation. 항목(xterm 탭이 갱신)과 core가 알린 runtime 중 큰 쪽이고, 모르면 0이다. */
  generationOf(key: string): number {
    const ref = this.refOf(key);
    return Math.max(
      this.#entries.get(key)?.generation ?? 0,
      ref === null ? 0 : (this.#generations.get(ref) ?? 0),
    );
  }

  /** 탭의 터미널 안에서 도는 coding agent. 없으면 undefined다. */
  agentOf(key: string): TabAgent | undefined {
    const ref = this.refOf(key);
    return ref === null ? undefined : this.#agents.get(ref);
  }

  /** 탭의 터미널에서 도는 coding session(GUI view와 바꿀 수 있는가). 없으면 undefined다. */
  codingOf(key: string): CodingSession | undefined {
    const ref = this.refOf(key);
    return ref === null ? undefined : this.#coding.get(ref);
  }

  /** 항목이나 agent가 바뀔 때마다 오르는 값. 탭 줄이 useSyncExternalStore로 읽어 다시 그린다. */
  version(): number {
    return this.#version;
  }

  /** core가 보낸 runtime(event, open·snapshot 답)의 agent를 반영한다. 같으면 아무것도 하지 않는다. */
  noteRuntime(runtime: TerminalRuntime): void {
    for (const listener of this.#runtimeListeners) listener(runtime);
    const ref = runtime.terminal_ref;
    const generationChanged = this.#generations.get(ref) !== runtime.generation;
    this.#generations.set(ref, runtime.generation);
    const before = this.#agents.get(ref);
    const next =
      runtime.agent === undefined
        ? undefined
        : { ...runtime.agent, unseen: this.#unseen.has(ref) };
    // 칸을 골라 비교하면 새 칸(foreground, name)이 빠져, hook 뒤에 온 foreground 알림을 버리고 GUI 전환을 막았다.
    // core(tracker)가 agent를 같은 순서로 만들어 JSON으로 비교한다.
    if (JSON.stringify(before) === JSON.stringify(next)) {
      if (generationChanged) this.#agentsChanged();
      return;
    }
    if (next === undefined) this.#agents.delete(ref);
    else this.#agents.set(ref, next);
    this.#agentsChanged();
  }

  /** core가 알린 runtime마다 부른다(대기 목록의 Finished 줄). 해지를 돌려준다. */
  onRuntime(listener: (runtime: TerminalRuntime) => void): () => void {
    this.#runtimeListeners.add(listener);
    return () => this.#runtimeListeners.delete(listener);
  }

  /** core의 못 본 끝이 바뀌었다. 못 본 끝이 있는 terminal_ref 모두다. */
  noteUnseen(terminalRefs: ReadonlySet<string>): void {
    this.#unseen = terminalRefs;
    let changed = false;
    for (const [ref, agent] of this.#agents) {
      const unseen = terminalRefs.has(ref);
      if (agent.unseen === unseen) continue;
      this.#agents.set(ref, { ...agent, unseen });
      changed = true;
    }
    if (changed) this.#agentsChanged();
  }

  #agentsChanged(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  /** 이 창에 그 터미널의 탭이 있는지. hook 설치 물음은 그 터미널의 탭이 있는 창이 묻는다. */
  has(terminalRef: string): boolean {
    return this.#keyOf(terminalRef) !== undefined;
  }

  #keyOf(terminalRef: string): string | undefined {
    for (const [key, entry] of this.#entries) {
      if (entry.terminalRef === terminalRef) return key;
    }
    for (const [key, ref] of this.#remembered) {
      if (ref === terminalRef && !this.#entries.has(key)) return key;
    }
    return undefined;
  }

  /** OS 알림을 눌렀다. 이 창에 그 터미널 탭이 있으면 고르고, 없으면 무시한다. */
  reveal(terminalRef: string): void {
    const key = this.#keyOf(terminalRef);
    if (key !== undefined) this.select(key);
  }

  /** 작업대가 그 탭을 고르게 한다. sidebar의 터미널 session 줄이 쓴다. */
  select(key: string): void {
    for (const select of this.#selectors) select(key);
  }

  /** 사람이 터미널 열기를 눌렀다. 탭 화면이 그려지면 시작한다. */
  request(
    key: string,
    folderRef: string | null = null,
    once: { resume?: TerminalResume; command?: string; cwd?: string } = {},
  ): void {
    this.#entries.set(key, {
      requested: true,
      folderRef,
      terminalRef: null,
      generation: 0,
      phase: { kind: "opening" },
      ...(once.resume === undefined ? {} : { resume: once.resume }),
      ...(once.command === undefined ? {} : { command: once.command }),
      ...(once.cwd === undefined ? {} : { cwd: once.cwd }),
    });
    this.#changed();
  }

  /**
   * 이미 core에 있는 터미널을 탭으로 둔다(다른 창에서 옮겨 옴, 폰이나 agent가 연 터미널, 다시 켠 앱의 탭). 터미널은 그대로이고 탭 화면이
   * 처음 그릴 때 snapshot을 받아 generation과 phase를 정한다.
   */
  adopt(
    key: string,
    moved: {
      terminalRef: string;
      generation: number;
      folderRef: string | null;
    },
  ): void {
    this.#entries.set(key, {
      requested: true,
      phase: { kind: "opening" },
      ...moved,
    });
    this.#changed();
  }

  /** 작업대가 탭을 고르는 길을 등록한다. 해지를 돌려준다. */
  onSelect(listener: (key: string) => void): () => void {
    this.#selectors.add(listener);
    return () => this.#selectors.delete(listener);
  }

  update(key: string, patch: Partial<TerminalEntry>): void {
    const current = this.#entries.get(key) ?? {
      requested: false,
      folderRef: null,
      terminalRef: null,
      generation: 0,
      phase: { kind: "idle" } as Phase,
    };
    this.#entries.set(key, { ...current, ...patch });
    this.#changed();
  }

  delete(key: string): void {
    this.#remembered.delete(key);
    if (this.#entries.delete(key)) this.#changed();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}
