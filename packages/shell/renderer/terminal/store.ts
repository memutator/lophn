// 탭 key와 host runtime의 대응. 탭 전환·공간 이동으로 탭 화면이 사라져도 shell은
// 그대로이고, 다시 그릴 때 이 대응으로 같은 runtime에 붙는다.
// renderer가 다시 생기면 sessionStorage의 참조만으로 살아 있는 host buffer를 다시
// 읽는다. 출력·입력은 여기 두지 않는다. Electron을 다시 띄우면 sessionStorage가
// 비어 탭은 종료된 자리표시가 된다.
import type { TerminalApi } from "../../ipc/terminal.ts";
import { type Phase, phaseOfRuntime } from "./model.ts";
import type { TerminalOpenRequest } from "./use-terminal-open-requests.ts";

export interface TerminalEntry {
  /** 사람이 이 탭에서 터미널을 열었다. 아직 시작 전일 수 있다. */
  readonly requested: boolean;
  readonly folderRef: string | null;
  readonly terminalRef: string | null;
  readonly generation: number;
  readonly phase: Phase;
  /** core 요청으로 열린 coding session의 탭이면 그 session. 사람이 연 shell 탭은 null이다. */
  readonly session: string | null;
}

const STORAGE_KEY = "lophn.terminal.tabs";

interface Persisted {
  readonly terminal_ref: string;
  readonly generation: number;
  readonly folder_ref: string | null;
  readonly session: string | null;
}

/** sessionStorage 모양. 테스트는 Map으로 대신한다. */
export interface RefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class TerminalStore {
  readonly #entries = new Map<string, TerminalEntry>();
  readonly #listeners = new Set<() => void>();
  readonly #selectors = new Set<(key: string) => void>();
  readonly #storage: RefStorage | null;
  readonly #bridge: TerminalApi | null;

  constructor(
    storage: RefStorage | null = sessionStorageOrNull(),
    bridge: TerminalApi | null = windowBridgeOrNull(),
  ) {
    this.#storage = storage;
    this.#bridge = bridge;
    for (const [key, value] of Object.entries(this.#load())) {
      this.#entries.set(key, {
        requested: true,
        folderRef: value.folder_ref,
        terminalRef: value.terminal_ref,
        generation: value.generation,
        phase: { kind: "opening" },
        session: value.session,
      });
    }
  }

  get(key: string): TerminalEntry | undefined {
    return this.#entries.get(key);
  }

  /** 사람이 터미널 열기를 눌렀다. 탭 화면이 그려지면 시작한다. */
  request(key: string, folderRef: string | null = null): void {
    this.#entries.set(key, {
      requested: true,
      folderRef,
      terminalRef: null,
      generation: 0,
      phase: { kind: "opening" },
      session: null,
    });
    this.#changed();
  }

  /**
   * core 요청으로 열린 coding runtime을 탭으로 둔다. PTY는 main이 이미 만들었으니 탭 화면이
   * 그 runtime에 붙기만 한다. 사람이 누른 것이 아니라 시작하지 않고, 같은 session이 이미
   * 탭이면 그 탭을 그대로 둔다.
   */
  requestFromCore(request: TerminalOpenRequest): void {
    const { tab, coding, runtime } = request;
    if (this.#entries.has(tab.key)) return;
    this.#entries.set(tab.key, {
      requested: true,
      folderRef: runtime.folder_ref,
      terminalRef: runtime.terminal_ref,
      generation: runtime.generation,
      phase: phaseOfRuntime(runtime),
      session: coding.session,
    });
    this.#changed();
  }

  /** session의 터미널 탭 key. 이 창에 없으면 null이다. */
  tabOfSession(session: string): string | null {
    for (const [key, entry] of this.#entries) {
      if (entry.session === session) return key;
    }
    return null;
  }

  /** 작업대가 탭을 고르는 길을 등록한다. 해지를 돌려준다. */
  onSelect(listener: (key: string) => void): () => void {
    this.#selectors.add(listener);
    return () => this.#selectors.delete(listener);
  }

  /**
   * 대기 목록 카드의 [Answer in terminal]. 이 창에 열려 있는 탭이면 고르고, 없으면 main에
   * 맡긴다. 고르거나 main이 받았으면 true다.
   */
  async focusSession(session: string): Promise<boolean> {
    const key = this.tabOfSession(session);
    if (key !== null && this.#selectors.size > 0) {
      for (const select of this.#selectors) select(key);
      return true;
    }
    if (!this.#bridge) return false;
    const reply = await this.#bridge.focusSession({ session });
    return reply.ok && reply.value.ok;
  }

  update(key: string, patch: Partial<TerminalEntry>): void {
    const current = this.#entries.get(key) ?? {
      requested: false,
      folderRef: null,
      terminalRef: null,
      generation: 0,
      phase: { kind: "idle" } as Phase,
      session: null,
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
            folder_ref: typeof value.folder_ref === "string"
              ? value.folder_ref
              : null,
            session: typeof value.session === "string" ? value.session : null,
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
        session: entry.session,
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
