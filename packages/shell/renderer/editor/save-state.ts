// 파일 하나의 저장 흐름. 저장 버튼 없이 입력이 멈추면 디스크에 쓰고, 상태는 saved·saving·failed·
// unknown·conflict뿐이다. 쓸 때는 마지막으로 읽거나 쓴 hash를 base_hash로 보내고, 디스크가 그
// 사이 바뀌었으면 main이 conflict로 거절한다. 충돌이면 사람이 고르기 전까지 쓰지 않고 초안을
// 그대로 둔다. 결과를 모르는 쓰기는 다시 쓰지 않고 먼저 읽어 본다. 순수 모듈이라 clock·port를
// 주입한다.
import type { FileReply, FileText, FileWritten } from "../../ipc/files.ts";

/** 입력이 이만큼 멈추면 디스크에 쓴다. */
export const SAVE_QUIET_MS = 800;
/** 결과를 모르는 쓰기를 다시 확인하는 간격. 다 쓰면 사람의 다시 시도를 기다린다. */
export const CHECK_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export interface SaveClock {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const systemSaveClock: SaveClock = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** main 파일 통로의 이 파일 하나. */
export interface SavePort {
  write(
    input: { base_hash: string | null; text: string },
  ): Promise<FileReply<FileWritten>>;
  read(): Promise<FileReply<FileText>>;
}

/**
 * saved: 디스크에 편집기 글이 있다. saving: 쓸 글이 있다(입력 대기, 쓰는 중). failed: 쓰기가
 * 거절됐다. unknown: 썼는지 모른다. conflict: 디스크가 밖에서 바뀌었다.
 */
export type SaveState = "saved" | "saving" | "failed" | "unknown" | "conflict";

export interface SaveFacts {
  readonly state: SaveState;
}

export interface SaveSessionOptions {
  port: SavePort;
  /** 연 글. */
  text: string;
  /** 연 디스크 글의 hash. 없는 파일을 빈 buffer로 열면 null이다. */
  hash: string | null;
  clock?: SaveClock;
}

/** external: 밖에서 바뀐 파일을 다시 읽었다. theirs: 사람이 충돌에서 디스크 쪽을 골랐다. */
export type ReplaceCause = "external" | "theirs";

export class SaveSession {
  readonly #port: SavePort;
  readonly #clock: SaveClock;
  readonly #listeners = new Set<(facts: SaveFacts) => void>();
  readonly #replacers = new Set<(text: string, cause: ReplaceCause) => void>();
  #state: SaveState = "saved";
  /** 편집기의 지금 글. */
  #text: string;
  /** 디스크에 있다고 아는 글. */
  #disk: string;
  #base: string | null;
  #timer: unknown = null;
  #inFlight: Promise<void> | null = null;
  /** 쓰는 사이 알려 온 디스크 변화. 쓴 뒤에 내 쓰기의 메아리인지 가린다. */
  #seen: (string | null)[] = [];
  /** 결과를 모르는 쓰기. 읽어서만 푼다. */
  #unknown: { text: string; base: string | null } | null = null;
  #checks = 0;
  #closed = false;

  constructor(options: SaveSessionOptions) {
    this.#port = options.port;
    this.#clock = options.clock ?? systemSaveClock;
    this.#text = options.text;
    this.#disk = options.text;
    this.#base = options.hash;
  }

  get facts(): SaveFacts {
    return { state: this.#state };
  }

  /** 편집기의 지금 글(디스크에 없는 것 포함). */
  get text(): string {
    return this.#text;
  }

  subscribe(listener: (facts: SaveFacts) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 편집기 글을 바꿔야 할 때(밖에서 바뀐 파일을 다시 읽음, 디스크 쪽을 고름)의 알림. */
  onReplace(
    listener: (text: string, cause: ReplaceCause) => void,
  ): () => void {
    this.#replacers.add(listener);
    return () => this.#replacers.delete(listener);
  }

  /** 디스크 저장이 끝나지 않았다. */
  unsettled(): boolean {
    return this.#state !== "saved";
  }

  /** 쓰기를 멈춘 상태. 사람이 풀어야 다시 쓴다. */
  blocked(): boolean {
    return this.#state === "conflict" || this.#state === "unknown";
  }

  /** 편집기의 고침. 멈춘 상태가 아니면 입력이 멈춘 뒤 쓴다. */
  edit(text: string): void {
    if (this.#closed || text === this.#text) return;
    this.#text = text;
    if (this.blocked()) return;
    if (text === this.#disk && !this.#inFlight) {
      this.#cancel();
      this.#set("saved");
      return;
    }
    this.#set("saving");
    this.#schedule(SAVE_QUIET_MS);
  }

  /** 지금 쓴다. 디스크가 편집기 글을 가졌으면 true다. */
  async flush(): Promise<boolean> {
    if (this.#closed) return !this.unsettled();
    this.#cancel();
    while (this.#inFlight) await this.#inFlight;
    if (this.blocked()) return false;
    if (this.#text !== this.#disk) await this.#start();
    return !this.unsettled();
  }

  /** 실패한 쓰기를 다시 하거나 결과를 모르는 쓰기를 다시 확인한다. */
  async retry(): Promise<void> {
    if (this.#closed) return;
    if (this.#state === "unknown") {
      this.#checks = 0;
      await this.#run(() => this.#check());
    } else if (this.#state === "failed") {
      this.#cancel();
      await this.#start();
    }
  }

  /** 디스크가 밖에서 바뀌었다는 알림(onChanged). 내 쓰기의 메아리는 무시한다. */
  async external(hash: string | null): Promise<void> {
    if (this.#closed) return;
    if (this.#inFlight) {
      this.#seen.push(hash);
      return;
    }
    await this.#changedOutside(hash);
  }

  /** 충돌 비교: 지금 디스크 글. */
  async readDisk(): Promise<FileReply<FileText>> {
    return await this.#port.read();
  }

  /** 충돌 해결: 지금 디스크 위에 편집기 글을 쓴다. 사람이 고른 때만 부른다. */
  async keepMine(): Promise<void> {
    if (this.#closed || this.#state !== "conflict") return;
    const reply = await this.#port.read();
    if (reply.ok) this.#base = reply.value.hash;
    else if (reply.code === "not_found") this.#base = null;
    else return;
    this.#set("saving");
    await this.#start();
  }

  /** 충돌 해결: 디스크 글을 받는다. 초안은 사람이 고른 때만 버린다. */
  async takeTheirs(): Promise<boolean> {
    if (this.#closed || this.#state !== "conflict") return false;
    const reply = await this.#port.read();
    if (!reply.ok) return false;
    this.#adopt(reply.value.text, reply.value.hash, "theirs");
    return true;
  }

  /** 명시 폐기. 남은 고침을 버리고 더 쓰지 않는다. */
  discard(): void {
    this.#closed = true;
    this.#cancel();
    this.#text = this.#disk;
    this.#unknown = null;
    this.#set("saved");
  }

  dispose(): void {
    this.#closed = true;
    this.#cancel();
    this.#listeners.clear();
    this.#replacers.clear();
  }

  async #changedOutside(hash: string | null): Promise<void> {
    if (hash === this.#base || this.blocked()) return;
    if (this.#text !== this.#disk) {
      this.#conflict();
      return;
    }
    // 지워진 파일은 다시 읽을 것이 없다. 다음 쓰기가 충돌로 알린다.
    if (hash === null) return;
    const reply = await this.#port.read();
    if (!reply.ok || this.#closed || reply.value.hash === this.#base) return;
    // 읽는 사이 고쳤으면 디스크 글로 덮지 않고 충돌로 둔다.
    if (this.#text !== this.#disk) {
      this.#conflict();
      return;
    }
    this.#adopt(reply.value.text, reply.value.hash, "external");
  }

  #set(state: SaveState): void {
    if (this.#state === state) return;
    this.#state = state;
    const facts = this.facts;
    for (const listener of this.#listeners) listener(facts);
  }

  #adopt(text: string, hash: string | null, cause: ReplaceCause): void {
    this.#cancel();
    this.#unknown = null;
    this.#text = text;
    this.#disk = text;
    this.#base = hash;
    this.#set("saved");
    for (const replacer of this.#replacers) replacer(text, cause);
  }

  #conflict(): void {
    this.#cancel();
    this.#set("conflict");
  }

  #schedule(ms: number): void {
    this.#cancel();
    this.#timer = this.#clock.set(() => {
      this.#timer = null;
      void this.#start();
    }, ms);
  }

  #cancel(): void {
    if (this.#timer === null) return;
    this.#clock.clear(this.#timer);
    this.#timer = null;
  }

  #start(): Promise<void> {
    return this.#run(() => this.#write());
  }

  #run(task: () => Promise<void>): Promise<void> {
    if (this.#inFlight) return this.#inFlight;
    const run = task().finally(() => {
      if (this.#inFlight === run) this.#inFlight = null;
    });
    this.#inFlight = run;
    return run;
  }

  async #write(): Promise<void> {
    const text = this.#text;
    const base = this.#base;
    this.#set("saving");
    const reply = await this.#port.write({ base_hash: base, text });
    if (this.#closed) return;
    if (reply.ok) {
      this.#base = reply.value.hash;
      this.#disk = text;
      this.#afterWrite();
      return;
    }
    this.#seen = [];
    if (reply.code === "conflict") {
      this.#conflict();
    } else if (reply.code === "unavailable") {
      this.#unknown = { text, base };
      this.#checks = 0;
      await this.#check();
    } else {
      this.#set("failed");
    }
  }

  // 쓰는 사이 온 디스크 변화 가운데 내 쓰기가 아닌 것이 있으면 내 쓰기 뒤에 밖에서 바뀐 것이다.
  #afterWrite(): void {
    const outside = this.#seen.filter((hash) => hash !== this.#base).at(-1);
    this.#seen = [];
    if (this.#text !== this.#disk) {
      this.#set("saving");
      this.#schedule(SAVE_QUIET_MS);
    } else {
      this.#set("saved");
    }
    if (outside !== undefined) void this.#changedOutside(outside);
  }

  // 결과를 모르는 쓰기를 읽어서 푼다. 같은 글을 다시 쓰지 않는다.
  async #check(): Promise<void> {
    const sent = this.#unknown;
    if (sent === null) return;
    this.#set("unknown");
    const reply = await this.#port.read();
    if (this.#unknown !== sent || this.#closed) return;
    const missing = !reply.ok && reply.code === "not_found";
    if (!reply.ok && !missing) {
      const delay = CHECK_DELAYS_MS[this.#checks];
      this.#checks += 1;
      if (delay !== undefined) {
        this.#cancel();
        this.#timer = this.#clock.set(() => {
          this.#timer = null;
          void this.#run(() => this.#check());
        }, delay);
      }
      return;
    }
    this.#unknown = null;
    if (reply.ok && reply.value.text === sent.text) {
      this.#base = reply.value.hash;
      this.#disk = sent.text;
      this.#afterWrite();
    } else if (
      missing ? sent.base === null : reply.ok && reply.value.hash === sent.base
    ) {
      // 쓰기 전 그대로다. 이제 결과를 아니 다시 쓴다.
      await this.#write();
    } else {
      this.#conflict();
    }
  }
}
