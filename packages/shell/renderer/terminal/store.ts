// 탭 key와 host runtime의 대응. 탭 전환·공간 이동으로 탭 화면이 사라져도 shell은
// 그대로이고, 다시 그릴 때 이 대응으로 같은 runtime에 붙는다.
// renderer가 다시 생기면 sessionStorage의 참조만으로 살아 있는 host buffer를 다시
// 읽는다. 출력·입력은 여기 두지 않는다. Electron을 다시 띄우면 sessionStorage가
// 비어 탭은 종료된 자리표시가 된다.
import type {
  TerminalAgent,
  TerminalApi,
  TerminalResume,
  TerminalRuntime,
} from "../../ipc/terminal.ts";
import { type Phase, stripStatusGlyphs } from "./model.ts";

export interface TerminalEntry {
  /** 사람이 이 탭에서 터미널을 열었다. 아직 시작 전일 수 있다. */
  readonly requested: boolean;
  readonly folderRef: string | null;
  readonly terminalRef: string | null;
  readonly generation: number;
  readonly phase: Phase;
  /** 처음 여는 한 번만 main이 shell 뒤에 resume 명령을 친다. 저장하지 않고, 열 때 비운다. */
  readonly resume?: TerminalResume;
  /** 처음 여는 한 번만 main이 shell에 넣는 명령(대화 코드 블록의 실행). resume과 같이 열 때 비운다. */
  readonly command?: string;
  /** 처음 여는 한 번만 main이 이 폴더(등록 폴더 안)에서 shell을 연다. 저장하지 않고, 열 때 비운다. */
  readonly cwd?: string;
  /**
   * snapshot을 PTY 치수로 다시 쓴 횟수. 쓴 뒤 view는 PTY 치수라, 탭이 이 값을 보고 칸에 다시 맞춘다(치수가 다르면 PTY도).
   * 저장하지 않는다.
   */
  readonly restored?: number;
}

const STORAGE_KEY = "lophn.terminal.tabs";

interface Persisted {
  readonly terminal_ref: string;
  readonly generation: number;
  readonly folder_ref: string | null;
}

/** sessionStorage 모양. 테스트는 Map으로 대신한다. */
interface RefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class TerminalStore {
  readonly #opening = new Set<string>();
  readonly #entries = new Map<string, TerminalEntry>();
  readonly #listeners = new Set<() => void>();
  readonly #selectors = new Set<(key: string) => void>();
  // 터미널 안에서 도는 coding agent. 탭 key가 아니라 terminal_ref로 둔다. main의 push가 탭 항목보다
  // 먼저 올 수 있고, 탭을 옮겨도 PTY 참조는 같다.
  readonly #agents = new Map<string, TerminalAgent>();
  // program이 OSC로 낸 제목의 마지막 값. agent와 같은 이유로 terminal_ref로 둔다.
  readonly #titles = new Map<string, string>();
  #version = 0;
  readonly #storage: RefStorage | null;

  constructor(
    storage: RefStorage | null = sessionStorageOrNull(),
    bridge: TerminalApi | null = windowBridgeOrNull(),
  ) {
    this.#storage = storage;
    for (const [key, value] of Object.entries(this.#load())) {
      this.#entries.set(key, {
        requested: true,
        folderRef: value.folder_ref,
        terminalRef: value.terminal_ref,
        generation: value.generation,
        phase: { kind: "opening" },
      });
    }
    // store는 창과 함께 살아 해지하지 않는다.
    bridge?.onRuntime((runtime) => this.noteRuntime(runtime));
    bridge?.onReveal(({ terminal_ref }) => this.reveal(terminal_ref));
  }

  get(key: string): TerminalEntry | undefined {
    return this.#entries.get(key);
  }

  beginOpen(key: string): boolean {
    if (this.#opening.has(key)) return false;
    this.#opening.add(key);
    return true;
  }

  endOpen(key: string): void {
    this.#opening.delete(key);
  }

  /** 탭의 터미널 안에서 도는 coding agent. 없으면 undefined다. */
  agentOf(key: string): TerminalAgent | undefined {
    const ref = this.#entries.get(key)?.terminalRef;
    return ref == null ? undefined : this.#agents.get(ref);
  }

  /** coding agent가 도는 동안 그 터미널의 마지막 OSC 제목. agent가 없거나 제목이 없으면 null이다. */
  agentTitleOf(key: string): string | null {
    const ref = this.#entries.get(key)?.terminalRef;
    return ref == null || !this.#agents.has(ref)
      ? null
      : (this.#titles.get(ref) ?? null);
  }

  /**
   * 터미널이 낸 제목을 적는다. spinner 같은 상태 글리프를 먼저 떼어, 프레임만 바뀌는 동안에는
   * store가 흔들리지 않게 한다(이 store를 구독하는 workspace가 매 프레임 다시 그리지 않는다).
   */
  noteTitle(terminalRef: string, title: string): void {
    const name = stripStatusGlyphs(title);
    if (this.#titles.get(terminalRef) === name) return;
    this.#titles.set(terminalRef, name);
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  /** 항목이나 agent가 바뀔 때마다 오르는 값. 탭 줄이 useSyncExternalStore로 읽어 다시 그린다. */
  version(): number {
    return this.#version;
  }

  /** main이 보낸 runtime(push, open·snapshot 답)의 agent를 반영한다. 같으면 아무것도 하지 않는다. */
  noteRuntime(runtime: TerminalRuntime): void {
    const before = this.#agents.get(runtime.terminal_ref);
    const next = runtime.agent;
    // 칸을 골라 비교하면 새 칸(foreground, name)이 빠져, hook 뒤에 온 foreground 알림을 버리고 GUI 전환을 막았다.
    // main(tracker)이 agent를 같은 순서로 만들어 JSON으로 비교한다.
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    if (next === undefined) this.#agents.delete(runtime.terminal_ref);
    else this.#agents.set(runtime.terminal_ref, next);
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  /** OS 알림을 눌렀다. 이 창에 그 터미널 탭이 있으면 고르고, 없으면 무시한다. */
  reveal(terminalRef: string): void {
    for (const [key, entry] of this.#entries) {
      if (entry.terminalRef !== terminalRef) continue;
      this.select(key);
      return;
    }
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
   * 다른 창에서 옮겨 온 runtime을 탭으로 둔다. PTY는 그대로이고 탭 화면이 처음 그릴 때
   * snapshot을 0부터 받아 phase를 정한다.
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
    if (this.#entries.delete(key)) this.#changed();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    this.#version += 1;
    this.#save();
    for (const listener of this.#listeners) listener();
  }

  #load(): Record<string, Persisted> {
    try {
      const raw = this.#storage?.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, Persisted>;
      const kept: Record<string, Persisted> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (
          typeof value?.terminal_ref === "string" &&
          typeof value.generation === "number"
        ) {
          kept[key] = {
            terminal_ref: value.terminal_ref,
            generation: value.generation,
            folder_ref:
              typeof value.folder_ref === "string" ? value.folder_ref : null,
          };
        }
      }
      return kept;
    } catch {
      return {};
    }
  }

  #save(): void {
    const persisted: Record<string, Persisted> = {};
    for (const [key, entry] of this.#entries) {
      if (entry.terminalRef === null) continue;
      persisted[key] = {
        terminal_ref: entry.terminalRef,
        generation: entry.generation,
        folder_ref: entry.folderRef,
      };
    }
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // 저장하지 못하면 renderer를 다시 만들 때 종료된 자리표시가 된다.
    }
  }
}

function sessionStorageOrNull(): RefStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function windowBridgeOrNull(): TerminalApi | null {
  return (globalThis as { lophnTerminal?: TerminalApi }).lophnTerminal ?? null;
}
