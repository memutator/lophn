// 문서 하나의 저장 흐름(shell/editor#R1, R2, R12, R15). 저장 버튼 없이 고침을 main의 파일
// adapter로 보낸다. 디스크 저장·기록 확인·version 확정·형식 검사를 따로 기억하고, 뒤 단계 실패가
// 이미 성공한 파일 저장을 지우지 않는다. 결과를 모르는 쓰기는 다시 쓰지 않고 documents 상태부터
// 본다. 충돌이면 쓰기를 멈추고 초안을 그대로 둔다. version 경계(편집 종료)는 사람의 조작
// (탭 닫기·전환·읽기 전환·창 닫기·CommandOrControl+S)에서만 오고, 유휴 종료는 documents가 알린
// 상태로만 반영한다. 이 모듈에는 version timer가 없다. 순수 모듈이라 clock·port를 주입한다.
import type {
  EditorDiagnostic,
  EditorReply,
  LookupReport,
  SaveReport,
  WatchReport,
} from "../../ipc/editor.ts";

/** 입력이 이만큼 멈추면 디스크에 쓴다. */
export const SAVE_QUIET_MS = 800;
/** 실패한 쓰기를 다시 시도하는 간격. 다 쓰면 실패를 보이고 사람의 다시 시도를 기다린다. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export interface SaveClock {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

export const systemSaveClock: SaveClock = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** main 파일 adapter의 이 문서 session. */
export interface SavePort {
  write(input: {
    request_key: string;
    base_hash: string | null;
    bytes: Uint8Array;
    end: boolean;
    base_version?: string;
  }): Promise<EditorReply<SaveReport>>;
  lookup(request_key: string): Promise<EditorReply<LookupReport>>;
}

export type DiskState =
  | "none"
  | "saved"
  | "failed"
  | "offline"
  | "conflict"
  | "unknown";
export type RecordState = "none" | "recorded" | "unverified";
export type VersionState =
  | "none"
  /** 편집 종료 전. 고침은 디스크에만 있다. */
  | "waiting"
  | "not_requested"
  | "preparing"
  | "confirmed"
  | "conflict"
  | "validation_failed";
export type FormatState = "none" | "passed" | "failed";

/** 단계별 사실. 각 사실은 마지막으로 안 시각(ms)을 함께 둔다. */
export interface SaveFacts {
  /** idle: 쓸 것 없음, waiting: 입력 멈춤·다시 시도 대기, saving: 쓰는 중. */
  readonly pipeline: "idle" | "waiting" | "saving";
  /** 디스크에 아직 없는 글이 있다. */
  readonly dirty: boolean;
  /** 마지막 편집 종료 뒤 디스크에 쓴 고침이 있다(편집 종료가 아직이다). */
  readonly edited: boolean;
  /** 실패한 쓰기를 곧 다시 시도한다. */
  readonly retrying: boolean;
  readonly disk: { readonly state: DiskState; readonly at: number | null };
  readonly record: { readonly state: RecordState; readonly at: number | null };
  readonly version: {
    readonly state: VersionState;
    readonly at: number | null;
    /** version 충돌의 지금 최신 판. */
    readonly latest: string | null;
  };
  readonly format: {
    readonly state: FormatState;
    readonly problems: readonly EditorDiagnostic[];
    readonly at: number | null;
  };
}

export const INITIAL_FACTS: SaveFacts = {
  pipeline: "idle",
  dirty: false,
  edited: false,
  retrying: false,
  disk: { state: "none", at: null },
  record: { state: "none", at: null },
  version: { state: "none", at: null, latest: null },
  format: { state: "none", problems: [], at: null },
};

export interface SaveSessionOptions {
  port: SavePort;
  /** 연 디스크 바이트의 hash. working copy를 아직 만들지 않았으면 null이다. */
  baseHash: string | null;
  /** 연 글. */
  text: string;
  clock?: SaveClock;
  newKey?: () => string;
}

/** 외부 변화 판단. reload면 호출자가 지금 파일을 읽어 reloaded로 넘긴다. */
export type StatusVerdict = "same" | "reload" | "ignore";

function newRequestKey(): string {
  return `edit-${crypto.randomUUID()}`;
}

const encoder = new TextEncoder();

export class SaveSession {
  readonly #port: SavePort;
  readonly #clock: SaveClock;
  readonly #newKey: () => string;
  readonly #listeners = new Set<(facts: SaveFacts) => void>();
  #facts: SaveFacts = INITIAL_FACTS;
  #base: string | null;
  /** 디스크에 있다고 아는 글. */
  #last: string;
  /** 디스크에 아직 없는 글. */
  #pending: string | null = null;
  #timer: unknown = null;
  #inFlight: Promise<void> | null = null;
  #failures = 0;
  /** 실패한 쓰기가 편집 종료였는지. 다시 시도도 종료로 보낸다. */
  #endWanted = false;
  /** 결과를 모르는 쓰기. lookup으로만 푼다. */
  #unknown: { key: string; text: string; end: boolean } | null = null;
  /** version 충돌 뒤 사람이 고른 새 기준 판. 다음 종료 쓰기에 싣는다. */
  #rebase: string | undefined;
  #closed = false;

  constructor(options: SaveSessionOptions) {
    this.#port = options.port;
    this.#clock = options.clock ?? systemSaveClock;
    this.#newKey = options.newKey ?? newRequestKey;
    this.#base = options.baseHash;
    this.#last = options.text;
  }

  get facts(): SaveFacts {
    return this.#facts;
  }

  /** 다음 쓰기의 base_hash. */
  get baseHash(): string | null {
    return this.#base;
  }

  /** 편집기의 지금 글(디스크에 없는 것 포함). */
  get text(): string {
    return this.#pending ?? this.#last;
  }

  subscribe(listener: (facts: SaveFacts) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 디스크·결과 확인이 끝나지 않았다(쓰는 중·대기·실패·불명·충돌). */
  unsettled(): boolean {
    const disk = this.#facts.disk.state;
    return this.#pending !== null || this.#inFlight !== null ||
      disk === "failed" || disk === "offline" || disk === "conflict" ||
      disk === "unknown";
  }

  /** 디스크에는 있지만 편집 종료를 아직 보내지 않았다. */
  needsEnd(): boolean {
    return this.#facts.edited && !this.#closed;
  }

  /** 쓰기를 멈춘 상태. 사람이 풀어야 다시 쓴다. */
  blocked(): boolean {
    const disk = this.#facts.disk.state;
    return disk === "conflict" || disk === "unknown";
  }

  /** 편집기의 고침. 멈춘 상태가 아니면 입력이 멈춘 뒤 쓴다. */
  edit(text: string): void {
    if (this.#closed || text === this.text) return;
    this.#pending = text;
    if (this.blocked()) {
      this.#set({ dirty: true });
      return;
    }
    // 실패를 다시 시도하는 중이면 그 간격을 그대로 둔다.
    if (this.#facts.retrying) {
      this.#set({ dirty: true });
      return;
    }
    this.#set({ dirty: true, pipeline: this.#inFlight ? "saving" : "waiting" });
    this.#schedule(SAVE_QUIET_MS, false);
  }

  /**
   * 지금 쓴다. end면 편집 종료로 보내 version 준비 경계를 연다. 남은 고침이 없어도 종료가
   * 아직이면 지금 바이트로 종료를 한 번 보낸다. 디스크가 편집기 글을 가졌으면 true다.
   */
  async flush(end: boolean): Promise<boolean> {
    if (this.#closed) return !this.unsettled();
    this.#cancel();
    while (this.#inFlight) await this.#inFlight;
    if (this.blocked()) return false;
    if (this.#pending !== null || (end && this.#facts.edited)) {
      await this.#start(end || this.#endWanted);
    }
    return !this.unsettled();
  }

  /** 실패 뒤 사람이 고른 다시 시도. */
  retry(): void {
    if (this.#closed || this.blocked()) return;
    this.#failures = 0;
    this.#cancel();
    this.#set({ retrying: false });
    void this.#start(this.#endWanted);
  }

  /** 결과를 모르는 쓰기를 documents 상태로 다시 본다. 다시 쓰지 않는다. */
  async check(): Promise<void> {
    const unknown = this.#unknown;
    if (unknown === null) return;
    const reply = await this.#port.lookup(unknown.key);
    if (this.#unknown !== unknown) return;
    if (!reply.ok || reply.value.state === "unknown") return;
    const now = this.#clock.now();
    const found = reply.value;
    this.#unknown = null;
    if (found.state === "written") {
      this.#base = found.observed_hash;
      this.#last = unknown.text;
      if (this.#pending === unknown.text) this.#pending = null;
      this.#set({
        dirty: this.#pending !== null,
        edited: !unknown.end,
        disk: { state: "saved", at: now },
        record: { state: "unverified", at: now },
      });
      if (this.#pending !== null) this.#schedule(SAVE_QUIET_MS, false);
      return;
    }
    if (found.state === "changed") {
      this.#pending = this.#pending ?? unknown.text;
      this.#set({ dirty: true, disk: { state: "conflict", at: now } });
      return;
    }
    // 쓰기 전 그대로다. 이제 결과를 알므로 다시 쓸 수 있다.
    this.#pending = this.#pending ?? unknown.text;
    this.#set({ dirty: true, disk: { state: "none", at: now } });
    void this.#start(unknown.end);
  }

  /** 충돌 해결: 지금 디스크 위에 편집기 글을 쓴다. 사람이 고른 때만 부른다. */
  async keepMine(currentHash: string | null): Promise<void> {
    if (this.#closed) return;
    this.#base = currentHash;
    this.#unknown = null;
    this.#pending = this.text;
    this.#set({ dirty: true, disk: { state: "none", at: null } });
    while (this.#inFlight) await this.#inFlight;
    await this.#start(false);
  }

  /** 충돌 해결: 디스크 글을 받는다. 초안은 사람이 고른 때만 버린다. */
  takeTheirs(text: string, hash: string | null): void {
    this.#cancel();
    this.#unknown = null;
    this.#pending = null;
    this.#last = text;
    this.#base = hash;
    this.#failures = 0;
    this.#set({
      dirty: false,
      retrying: false,
      pipeline: "idle",
      disk: { state: "saved", at: this.#clock.now() },
    });
  }

  /** version 충돌 해결: 최신 판을 새 기준으로 편집기 글을 판으로 확정한다. */
  async keepMineAsVersion(latest: string): Promise<void> {
    this.#rebase = latest;
    this.#set({ edited: true, version: { ...this.#facts.version } });
    await this.flush(true);
  }

  /** 디스크가 이 편집기 밖에서 바뀌었고 고침이 없어 받았다. */
  reloaded(text: string, hash: string | null): void {
    if (this.#pending !== null || this.#inFlight) return;
    this.#last = text;
    this.#base = hash;
  }

  /** documents가 알린 지금 파일 상태(files.watch). 유휴 종료도 이것으로만 반영한다. */
  applyStatus(status: WatchReport): StatusVerdict {
    if (this.#closed || this.#inFlight || this.#pending !== null) {
      return "ignore";
    }
    const disk = this.#facts.disk.state;
    if (disk === "conflict" || disk === "unknown") return "ignore";
    if (status.observed_hash !== null && status.observed_hash !== this.#base) {
      return "reload";
    }
    if (status.observed_hash === null) return "same";
    const now = this.#clock.now();
    const version = this.#facts.version.state;
    const asked = version === "preparing" || version === "waiting" ||
      this.#facts.edited;
    if (!asked) return "same";
    if (status.state === "tracked" && status.compared_version !== null) {
      // 디스크의 이 바이트가 판이 되었다. 편집 종료든 유휴 종료든 같은 결과다.
      this.#set({
        edited: false,
        version: { state: "confirmed", at: now, latest: null },
      });
    } else if (status.state === "validation_failed") {
      this.#set({
        edited: false,
        version: { state: "validation_failed", at: now, latest: null },
        format: this.#facts.format.state === "none"
          ? { state: "failed", problems: [], at: now }
          : this.#facts.format,
      });
    } else if (status.state === "not_tracked" && version === "preparing") {
      this.#set({ version: { state: "not_requested", at: now, latest: null } });
    }
    return "same";
  }

  /** 명시 폐기. 남은 고침을 버리고 더 쓰지 않는다. */
  discard(): void {
    this.#closed = true;
    this.#cancel();
    this.#pending = null;
    this.#unknown = null;
    this.#set({
      dirty: false,
      edited: false,
      retrying: false,
      pipeline: "idle",
      disk: this.#facts.disk.state === "saved"
        ? this.#facts.disk
        : { state: "none", at: null },
    });
  }

  dispose(): void {
    this.#closed = true;
    this.#cancel();
    this.#listeners.clear();
  }

  #set(patch: Partial<SaveFacts>): void {
    this.#facts = { ...this.#facts, ...patch };
    for (const listener of this.#listeners) listener(this.#facts);
  }

  #schedule(ms: number, end: boolean): void {
    this.#cancel();
    this.#timer = this.#clock.set(() => {
      this.#timer = null;
      if (this.#inFlight) {
        // 쓰는 중이면 끝난 뒤 이어 쓴다.
        void this.#inFlight.then(() => this.#schedule(0, end));
        return;
      }
      void this.#start(end || this.#endWanted);
    }, ms);
  }

  #cancel(): void {
    if (this.#timer === null) return;
    this.#clock.clear(this.#timer);
    this.#timer = null;
  }

  #start(end: boolean): Promise<void> {
    const run = this.#run(end).finally(() => {
      if (this.#inFlight === run) this.#inFlight = null;
      if (
        // 쓰는 사이 온 고침만 이어 쓴다. 실패 뒤에는 정한 다시 시도나 사람의 조작만 쓴다.
        this.#pending !== null && this.#facts.disk.state === "saved" &&
        !this.#closed && this.#timer === null
      ) {
        this.#schedule(SAVE_QUIET_MS, false);
      } else if (this.#pending === null && this.#facts.pipeline !== "idle") {
        this.#set({ pipeline: "idle" });
      }
    });
    this.#inFlight = run;
    return run;
  }

  async #run(end: boolean): Promise<void> {
    const text = this.text;
    const key = this.#newKey();
    const rebase = end ? this.#rebase : undefined;
    this.#set({ pipeline: "saving" });
    const reply = await this.#port.write({
      request_key: key,
      base_hash: this.#base,
      bytes: encoder.encode(text),
      end,
      ...(rebase === undefined ? {} : { base_version: rebase }),
    });
    const now = this.#clock.now();
    if (!reply.ok) {
      // preload 통로가 끊기면 main이 썼는지 모른다. 다른 거절은 쓰기 전 실패다.
      if (reply.code === "unavailable") {
        this.#lost(key, text, end, now);
        return;
      }
      this.#failed(end, now, reply.code === "offline" ? "offline" : "failed");
      return;
    }
    const report = reply.value;
    switch (report.disk) {
      case "written":
        this.#written(report, text, end, now);
        return;
      case "conflict":
        this.#pending = this.text;
        this.#set({
          pipeline: "idle",
          dirty: true,
          retrying: false,
          disk: { state: "conflict", at: now },
        });
        return;
      case "unknown":
        this.#lost(key, text, end, now);
        return;
      case "failed":
        this.#failed(
          end,
          now,
          report.failure === "offline" ? "offline" : "failed",
        );
        return;
    }
  }

  #written(report: SaveReport, text: string, end: boolean, now: number): void {
    this.#base = report.written_hash;
    this.#last = text;
    if (this.#pending === text) this.#pending = null;
    this.#failures = 0;
    this.#endWanted = false;
    const patch: { -readonly [K in keyof SaveFacts]?: SaveFacts[K] } = {
      dirty: this.#pending !== null,
      retrying: false,
      disk: { state: "saved", at: now },
      record: {
        state: report.recording === "recorded" ? "recorded" : "unverified",
        at: now,
      },
    };
    if (!end) {
      patch.edited = true;
      patch.version = { state: "waiting", at: now, latest: null };
    } else {
      patch.edited = false;
      const version = report.version ?? "not_requested";
      patch.version = {
        state: version,
        at: now,
        latest: report.latest_version,
      };
      if (version !== "conflict") this.#rebase = undefined;
      if (report.problems !== null) {
        const failed = report.problems.some((item) =>
          item.severity === "error"
        );
        patch.format = {
          state: failed || version === "validation_failed"
            ? "failed"
            : "passed",
          problems: report.problems,
          at: now,
        };
      } else if (version === "validation_failed") {
        patch.format = { state: "failed", problems: [], at: now };
      }
    }
    this.#set(patch);
  }

  #lost(key: string, text: string, end: boolean, now: number): void {
    this.#unknown = { key, text, end };
    this.#pending = this.text;
    this.#set({
      pipeline: "idle",
      dirty: true,
      retrying: false,
      disk: { state: "unknown", at: now },
    });
    // 다시 쓰지 않는다. documents 상태부터 본다.
    void this.check();
  }

  #failed(end: boolean, now: number, state: "failed" | "offline"): void {
    this.#pending = this.text;
    this.#endWanted = this.#endWanted || end;
    const delay = RETRY_DELAYS_MS[this.#failures];
    this.#failures += 1;
    this.#set({
      pipeline: delay === undefined ? "idle" : "waiting",
      dirty: true,
      retrying: delay !== undefined,
      disk: { state, at: now },
    });
    if (delay !== undefined) {
      this.#cancel();
      this.#timer = this.#clock.set(() => {
        this.#timer = null;
        this.#set({ retrying: false });
        void this.#start(this.#endWanted);
      }, delay);
    }
  }
}

// ---- 머리 메타 줄과 상세

/** 메타 줄에서 고를 수 있는 다음 행동 하나. */
export type SaveAction = "retry" | "check" | "compare" | "problems" | null;

export type SaveHeadline =
  | { readonly kind: "none" }
  | {
    readonly kind:
      | "saving"
      | "saved"
      | "version-pending"
      | "version-saved"
      | "not-tracked"
      | "format-failed"
      | "version-conflict"
      | "conflict"
      | "unknown"
      | "failed"
      | "offline";
    readonly tone: "muted" | "warning" | "critical";
    readonly action: SaveAction;
    readonly count?: number;
  };

/** 지금 결과나 다음 행동 하나. 앞의 실패가 뒤의 성공보다 먼저다. */
export function saveHeadline(facts: SaveFacts): SaveHeadline {
  const disk = facts.disk.state;
  if (disk === "conflict") {
    return { kind: "conflict", tone: "warning", action: "compare" };
  }
  if (disk === "unknown") {
    return { kind: "unknown", tone: "warning", action: "check" };
  }
  if ((disk === "failed" || disk === "offline") && !facts.retrying) {
    return {
      kind: disk === "offline" ? "offline" : "failed",
      tone: "critical",
      action: "retry",
    };
  }
  if (facts.dirty || facts.pipeline !== "idle") {
    return { kind: "saving", tone: "muted", action: null };
  }
  if (disk !== "saved") return { kind: "none" };
  switch (facts.version.state) {
    case "conflict":
      return { kind: "version-conflict", tone: "warning", action: "compare" };
    case "validation_failed":
      return {
        kind: "format-failed",
        tone: "warning",
        action: facts.format.problems.length > 0 ? "problems" : null,
        count: facts.format.problems.filter((item) => item.severity === "error")
          .length,
      };
    case "preparing":
      return { kind: "version-pending", tone: "muted", action: null };
    case "confirmed":
      return { kind: "version-saved", tone: "muted", action: null };
    case "not_requested":
      return { kind: "not-tracked", tone: "muted", action: null };
    default:
      return {
        kind: "saved",
        tone: "muted",
        action: facts.format.state === "failed" ? "problems" : null,
      };
  }
}

/** 상세의 한 줄: 단계, 그 사실, 안 시각. */
export interface SaveDetail {
  readonly stage: "file" | "record" | "version" | "format";
  readonly value: string;
  readonly at: number | null;
}

/** 단계별 사실. 아직 모르는 단계도 빠뜨리지 않고 보인다. */
export function saveDetails(facts: SaveFacts): SaveDetail[] {
  const file = facts.dirty || facts.pipeline === "saving"
    ? (facts.disk.state === "none" || facts.disk.state === "saved"
      ? "saving"
      : facts.disk.state)
    : facts.disk.state;
  return [
    { stage: "file", value: file, at: facts.disk.at },
    { stage: "record", value: facts.record.state, at: facts.record.at },
    { stage: "version", value: facts.version.state, at: facts.version.at },
    {
      stage: "format",
      value: facts.format.state,
      at: facts.format.at,
    },
  ];
}

// ---- 문서 옆 notice

export type NoticeKind =
  | "conflict"
  | "version-conflict"
  | "compare-failed"
  | "edit-offline"
  | "edit-too-large"
  | "edit-unsupported"
  | "edit-unavailable"
  | "width-failed"
  | "menu-unavailable"
  | "reloaded";

/** 높은 것이 먼저. 충돌은 해결까지 남고 디스크 재읽기 안내만 잠시 보였다 사라진다. */
const NOTICE_ORDER: readonly NoticeKind[] = [
  "conflict",
  "version-conflict",
  "compare-failed",
  "edit-offline",
  "edit-too-large",
  "edit-unsupported",
  "edit-unavailable",
  "width-failed",
  "menu-unavailable",
  "reloaded",
];

/** 디스크 재읽기 안내가 보이는 시간. */
export const RELOADED_NOTICE_MS = 3000;

export function topNotice(
  shown: readonly NoticeKind[],
): NoticeKind | null {
  return NOTICE_ORDER.find((kind) => shown.includes(kind)) ?? null;
}

/** 저장 사실에서 나오는 notice. */
export function saveNotices(facts: SaveFacts): NoticeKind[] {
  const found: NoticeKind[] = [];
  if (facts.disk.state === "conflict") found.push("conflict");
  if (facts.version.state === "conflict") found.push("version-conflict");
  return found;
}
