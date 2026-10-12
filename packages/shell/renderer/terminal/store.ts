// 탭 key와 host runtime의 대응. 탭 전환·공간 이동으로 탭 화면이 사라져도 shell은
// 그대로이고, 다시 그릴 때 이 대응으로 같은 runtime에 붙는다.
// renderer가 다시 생기면 sessionStorage의 참조만으로 살아 있는 host buffer를 다시
// 읽는다. 출력·입력은 여기 두지 않는다. Electron을 다시 띄우면 sessionStorage가
// 비어 탭은 종료된 자리표시가 된다.
import type { Phase } from "./model.ts";

export interface TerminalEntry {
  /** 사람이 이 탭에서 터미널을 열었다. 아직 시작 전일 수 있다. */
  readonly requested: boolean;
  readonly folderRef: string | null;
  readonly terminalRef: string | null;
  readonly generation: number;
  readonly phase: Phase;
}

const STORAGE_KEY = "lophn.terminal.tabs";

interface Persisted {
  readonly terminal_ref: string;
  readonly generation: number;
  readonly folder_ref: string | null;
}

/** sessionStorage 모양. 테스트는 Map으로 대신한다. */
export interface RefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class TerminalStore {
  readonly #entries = new Map<string, TerminalEntry>();
  readonly #listeners = new Set<() => void>();
  readonly #storage: RefStorage | null;

  constructor(storage: RefStorage | null = sessionStorageOrNull()) {
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
    });
    this.#changed();
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
