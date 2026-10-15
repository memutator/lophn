// 판이 아직 없는 새 문서의 편집(지침 파일의 첫 저장). 원본 파일도 working
// copy도 없어 입력 멈춤에 쓸 곳이 없다. 글은 이 창이 들고 있고, 편집 종료(읽기 전환·
// CommandOrControl+S·화면 떠남·창 닫기)가 main의 지침 통로로 첫 판을 만든다. 결과를 모르는
// 저장은 다시 저장하지 않고 그 예정 문서를 조회한다. 순수 모듈이라 clock·port를 주입한다.
import type { CreateReport, EditorReply } from "../../ipc/editor.ts";

/**
 * draft: 첫 판이 아직 없다(글은 이 창에). saving: 첫 판을 만드는 중.
 * saved: 첫 판이 생겼다. conflict: 그 사이 문서가 바뀌어 저장하지 않았다. failed·offline:
 * 저장하지 않았다. unknown: 저장했는지 모른다. pending: 파일은 썼고 첫 판은 documents의 관측을
 * 기다린다(지침 파일의 첫 저장).
 */
export type DraftDocumentState =
  | "draft"
  | "saving"
  | "saved"
  | "conflict"
  | "failed"
  | "offline"
  | "unknown"
  | "pending";

export interface DraftDocumentFacts {
  readonly state: DraftDocumentState;
  /** 처음 글에서 고쳤다. 첫 판이 아직이면 편집 종료가 그 판을 만든다. */
  readonly edited: boolean;
  /** 첫 판. */
  readonly version: string | null;
  /** 마지막으로 안 시각(ms). */
  readonly at: number | null;
}

export interface DraftDocumentPort {
  create(
    input: { request_key: string; bytes: Uint8Array },
  ): Promise<EditorReply<CreateReport>>;
  /** 그 예정 문서의 지금 최신 판. 아직 없으면 null, 조회하지 못하면 undefined다. */
  lookup(): Promise<string | null | undefined>;
}

export interface DraftDocumentOptions {
  port: DraftDocumentPort;
  /** 처음 글. */
  text: string;
  now?: () => number;
  newKey?: () => string;
}

const encoder = new TextEncoder();

export class DraftDocumentSession {
  readonly #port: DraftDocumentPort;
  readonly #now: () => number;
  readonly #newKey: () => string;
  readonly #listeners = new Set<(facts: DraftDocumentFacts) => void>();
  #text: string;
  #facts: DraftDocumentFacts = {
    state: "draft",
    edited: false,
    version: null,
    at: null,
  };
  #inFlight: Promise<void> | null = null;
  #closed = false;

  constructor(options: DraftDocumentOptions) {
    this.#port = options.port;
    this.#now = options.now ?? Date.now;
    this.#newKey = options.newKey ??
      (() => `draft-document-${crypto.randomUUID()}`);
    this.#text = options.text;
  }

  get text(): string {
    return this.#text;
  }

  get facts(): DraftDocumentFacts {
    return this.#facts;
  }

  subscribe(listener: (facts: DraftDocumentFacts) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 저장이 끝나지 않았다(만드는 중·실패·불명·충돌). 창 닫기가 묻는다. */
  unsettled(): boolean {
    if (this.#closed) return false;
    if (this.#inFlight !== null) return true;
    const state = this.#facts.state;
    return state === "failed" || state === "offline" || state === "unknown" ||
      state === "conflict";
  }

  /** 고친 글이 있고 첫 판은 아직이다. 편집 종료를 기다린다. */
  needsEnd(): boolean {
    return !this.#closed && this.#facts.edited &&
      this.#facts.state === "draft";
  }

  /** 편집기의 고침. 첫 판 전에는 이 창이 들고 있다. */
  edit(text: string): void {
    const state = this.#facts.state;
    if (
      this.#closed || state === "saved" || state === "pending" ||
      text === this.#text
    ) return;
    this.#text = text;
    if (!this.#facts.edited) this.#set({ edited: true });
  }

  /**
   * 편집 종료면 첫 판을 만든다. 입력 멈춤(end=false)에는 쓸 곳이 없어 아무것도 보내지 않는다.
   * 고친 글이 없으면 판을 만들지 않는다(가족 draft는 남는다). 끝났으면 true다.
   */
  async flush(end: boolean): Promise<boolean> {
    while (this.#inFlight) await this.#inFlight;
    if (!end || this.#closed) return !this.unsettled();
    const state = this.#facts.state;
    if (state === "saved" || state === "pending") return true;
    if (state === "conflict" || state === "unknown") return false;
    if (!this.#facts.edited) return true;
    await this.#start();
    return !this.unsettled();
  }

  /** 실패 뒤 사람이 고른 다시 시도. */
  retry(): void {
    const state = this.#facts.state;
    if (this.#closed || (state !== "failed" && state !== "offline")) return;
    void this.#start();
  }

  /**
   * 결과를 모르는 저장(unknown)이나 판 확정을 기다리는 저장(pending)을 그 예정 문서 조회로 다시
   * 본다. 다시 저장하지 않는다. 아직 없으면 unknown은 초안으로 돌아가고 pending은 그대로 기다린다.
   */
  async check(): Promise<void> {
    const before = this.#facts.state;
    if (before !== "unknown" && before !== "pending") return;
    const found = await this.#port.lookup();
    if (found === undefined || this.#facts.state !== before) return;
    if (found !== null) {
      this.#set({ state: "saved", version: found, at: this.#now() });
    } else if (before === "unknown") {
      this.#set({ state: "draft", at: this.#now() });
    }
  }

  /** 명시 폐기. 더 저장하지 않는다. */
  discard(): void {
    this.#closed = true;
  }

  dispose(): void {
    this.#closed = true;
    this.#listeners.clear();
  }

  #set(patch: Partial<DraftDocumentFacts>): void {
    this.#facts = { ...this.#facts, ...patch };
    for (const listener of this.#listeners) listener(this.#facts);
  }

  #start(): Promise<void> {
    const run = this.#run().finally(() => {
      if (this.#inFlight === run) this.#inFlight = null;
    });
    this.#inFlight = run;
    return run;
  }

  async #run(): Promise<void> {
    this.#set({ state: "saving" });
    const reply = await this.#port.create({
      request_key: this.#newKey(),
      bytes: encoder.encode(this.#text),
    });
    const now = this.#now();
    if (!reply.ok) {
      // preload 통로가 끊기면 main이 저장했는지 모른다. 다른 거절은 저장 전 실패다.
      if (reply.code === "unavailable") {
        this.#set({ state: "unknown", at: now });
        void this.check();
      } else {
        this.#set({
          state: reply.code === "offline" ? "offline" : "failed",
          at: now,
        });
      }
      return;
    }
    const report = reply.value;
    switch (report.outcome) {
      case "saved":
        this.#set({ state: "saved", version: report.version, at: now });
        return;
      case "conflict":
        this.#set({ state: "conflict", at: now });
        return;
      case "unknown":
        this.#set({ state: "unknown", at: now });
        return;
      case "pending":
        this.#set({ state: "pending", at: now });
        return;
      case "failed":
        this.#set({
          state: report.failure === "offline" ? "offline" : "failed",
          at: now,
        });
        return;
    }
  }
}
