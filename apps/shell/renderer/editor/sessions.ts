// 창 하나의 편집 session 묶음(shell/editor#R1). 문서 탭이 사라져도(전환·닫기) 저장이 끝나지
// 않은 session은 여기 남아 창 닫기와 끄기 확인이 센다. 탭 닫기·창 닫기는 마지막 고침을 보내
// 편집을 끝내고, 쓰기 실패·불명·충돌이 남으면 사람에게 묻는다(계속 편집·명시 폐기·다시 확인).
import type {
  CloseAnswer,
  CurrentFile,
  EditorCounts,
  EditorFilesApi,
  EditorReply,
  WatchReport,
} from "../../ipc/editor.ts";
import { SaveSession, type SavePort } from "./save-state.ts";

/** 남은 저장을 두고 떠날 때 사람의 선택. */
export type LeaveChoice = "keep" | "discard" | "check";

export interface LeaveAsker {
  /** name은 한 문서면 그 이름, 여러 문서면 null이다. */
  ask(name: string | null): Promise<LeaveChoice>;
}

export interface OpenedSession {
  readonly handle: string;
  readonly session: SaveSession;
  readonly name: string;
  readonly primaryPath: string | null;
}

interface Entry extends OpenedSession {
  /** 그 문서를 보는 화면 수. 0이면 저장이 끝나는 대로 놓는다. */
  views: number;
  unsubscribe: () => void;
}

export type OpenFailure =
  | "offline"
  | "too_large"
  | "unsupported"
  | "not_found"
  | "unavailable";

export class EditorSessions {
  readonly #api: EditorFilesApi;
  readonly #asker: LeaveAsker;
  readonly #entries = new Map<string, Entry>();
  readonly #opening = new Map<
    string,
    Promise<OpenedSession | OpenFailure>
  >();
  #reported: EditorCounts = { unsettled: 0, open: 0 };
  #disposeClose: (() => void) | null = null;

  constructor(api: EditorFilesApi, asker: LeaveAsker) {
    this.#api = api;
    this.#asker = asker;
  }

  /** main의 창 닫기 질문을 듣는다. 해제는 dispose다. */
  listen(): void {
    this.#disposeClose = this.#api.onCloseRequest((request) => {
      void this.closeWindow((answer) => this.#api.answerClose(request, answer))
        .then((answer) => this.#api.answerClose(request, answer));
    });
  }

  dispose(): void {
    this.#disposeClose?.();
    this.#disposeClose = null;
  }

  /** 문서를 편집으로 연다. 이미 이 창에 열린 session이 있으면 그것을 이어 쓴다. */
  attach(
    document: string,
    name: string,
  ): Promise<OpenedSession | OpenFailure> {
    const live = this.#entries.get(document);
    if (live) {
      live.views += 1;
      return Promise.resolve(live);
    }
    const pending = this.#opening.get(document);
    if (pending) {
      return pending.then((opened) => {
        if (typeof opened !== "string") {
          const entry = this.#entries.get(document);
          if (entry) entry.views += 1;
        }
        return opened;
      });
    }
    const opening = this.#open(document, name).finally(() =>
      this.#opening.delete(document)
    );
    this.#opening.set(document, opening);
    return opening;
  }

  async #open(
    document: string,
    name: string,
  ): Promise<OpenedSession | OpenFailure> {
    const reply = await this.#api.open({ document });
    if (!reply.ok) {
      return reply.code === "offline" || reply.code === "too_large" ||
          reply.code === "unsupported" || reply.code === "not_found"
        ? reply.code
        : "unavailable";
    }
    const handle = reply.value.session;
    const port: SavePort = {
      write: (input) => this.#api.write({ session: handle, ...input }),
      lookup: (key) =>
        this.#api.lookup({ session: handle, request_key: key }),
    };
    const session = new SaveSession({
      port,
      baseHash: reply.value.base_hash,
      text: reply.value.text,
    });
    const entry: Entry = {
      handle,
      session,
      name,
      primaryPath: reply.value.primary_path,
      views: 1,
      unsubscribe: session.subscribe(() => this.#changed(document)),
    };
    this.#entries.set(document, entry);
    return entry;
  }

  /** 화면이 그 문서를 떠났다(탭 전환·읽기 전환 없이 사라짐). 편집을 끝내고 남으면 둔다. */
  detach(document: string): void {
    const entry = this.#entries.get(document);
    if (!entry) return;
    entry.views = Math.max(0, entry.views - 1);
    if (entry.views > 0) return;
    void entry.session.flush(true).then(() => this.#changed(document));
  }

  /**
   * 탭 닫기. 마지막 고침을 보내 편집을 끝낸다. 실패·불명·충돌이 남으면 사람에게 묻고 계속
   * 편집을 고르면 false다(탭을 남긴다).
   */
  async leave(document: string): Promise<boolean> {
    const entry = this.#entries.get(document);
    if (!entry) return true;
    for (;;) {
      await entry.session.flush(true);
      if (!entry.session.unsettled()) return true;
      const choice = await this.#asker.ask(entry.name);
      if (choice === "keep") return false;
      if (choice === "discard") {
        entry.session.discard();
        this.#changed(document);
        return true;
      }
      await entry.session.check();
    }
  }

  /** 창 닫기. 모든 session을 끝내고 남은 것이 있으면 한 번에 묻는다. */
  async closeWindow(
    progress: (answer: CloseAnswer) => void = () => {},
  ): Promise<CloseAnswer> {
    const entries = [...this.#entries.values()];
    await Promise.all(entries.map((entry) => entry.session.flush(true)));
    for (;;) {
      const left = entries.filter((entry) => entry.session.unsettled());
      if (left.length === 0) return "allow";
      // 사람에게 묻는 동안 main은 기다린다.
      progress("asking");
      const choice = await this.#asker.ask(
        left.length === 1 ? left[0]!.name : null,
      );
      if (choice === "keep") return "stay";
      if (choice === "discard") {
        for (const entry of left) entry.session.discard();
        this.#report();
        return "allow";
      }
      for (const entry of left) {
        await entry.session.check();
        await entry.session.flush(true);
      }
    }
  }

  /** documents의 지금 파일 상태를 기다려 읽는다(files.watch). 바뀌거나 기한이 지나면 답한다. */
  watch(
    document: string,
    cursor: string | undefined,
  ): Promise<EditorReply<WatchReport>> {
    const entry = this.#entries.get(document);
    if (!entry) return Promise.resolve({ ok: false, code: "unknown_session" });
    return this.#api.watch({
      session: entry.handle,
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  /** 지금 디스크 글(충돌 비교·재읽기). */
  current(document: string): Promise<EditorReply<CurrentFile>> {
    const entry = this.#entries.get(document);
    if (!entry) return Promise.resolve({ ok: false, code: "unknown_session" });
    return this.#api.current({ session: entry.handle });
  }

  /** 이 창의 저장 중 수(끄기·창 닫기 확인). */
  counts(): EditorCounts {
    let unsettled = 0;
    let open = 0;
    for (const entry of this.#entries.values()) {
      if (entry.session.unsettled()) unsettled += 1;
      else if (entry.session.needsEnd()) open += 1;
    }
    return { unsettled, open };
  }

  #changed(document: string): void {
    const entry = this.#entries.get(document);
    if (
      entry && entry.views === 0 && !entry.session.unsettled() &&
      !entry.session.needsEnd()
    ) {
      // 아무 화면도 보지 않고 저장도 끝났다. main의 session을 놓는다.
      this.#entries.delete(document);
      entry.unsubscribe();
      entry.session.dispose();
      void this.#api.release({ session: entry.handle });
    }
    this.#report();
  }

  #report(): void {
    const next = this.counts();
    if (
      next.unsettled === this.#reported.unsettled &&
      next.open === this.#reported.open
    ) return;
    this.#reported = next;
    this.#api.counts(next);
  }
}
