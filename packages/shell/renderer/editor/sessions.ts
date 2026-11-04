// 창 하나의 편집 session 묶음. 파일 탭이 사라져도(전환·닫기) 저장이 끝나지 않은 session은 여기
// 남아 창 닫기 guard가 센다. 탭 닫기·창 닫기는 마지막 고침을 보내고, 쓰기 실패·불명·충돌이
// 남으면 사람에게 묻는다(계속 편집·명시 폐기·다시 확인). 밖에서 바뀐 파일의 알림(watch)도 여기서
// 받아 파일별로 나눈다.
import type { CloseAnswer, FileChanged, FileCounts } from "../../ipc/files.ts";
import { type SavePort, SaveSession } from "./save-state.ts";
import type { EditorFiles, OpenFailure } from "./source.ts";

/** 남은 저장을 두고 떠날 때 사람의 선택. */
export type LeaveChoice = "keep" | "discard" | "check";

export interface LeaveAsker {
  /** name은 한 파일이면 그 이름, 여러 파일이면 null이다. */
  ask(name: string | null): Promise<LeaveChoice>;
}

interface OpenedSession {
  readonly session: SaveSession;
  /** 연 글. 이미 열린 session이면 편집기의 지금 글이다. */
  readonly text: string;
}

interface Entry {
  readonly session: SaveSession;
  readonly name: string;
  /** 그 파일을 보는 화면 수. 0이면 저장이 끝나는 대로 놓는다. */
  views: number;
  readonly release: () => void;
}

export class EditorSessions {
  readonly files: EditorFiles;
  readonly #asker: LeaveAsker;
  readonly #entries = new Map<string, Entry>();
  readonly #opening = new Map<string, Promise<OpenedSession | OpenFailure>>();
  readonly #watchers = new Map<string, Set<(change: FileChanged) => void>>();
  readonly #unsettledListeners = new Set<() => void>();
  #reported: FileCounts = { unsettled: 0, open: 0 };
  #disposers: (() => void)[] = [];

  constructor(files: EditorFiles, asker: LeaveAsker) {
    this.files = files;
    this.#asker = asker;
  }

  /** main의 창 닫기 질문과 밖에서 바뀐 파일의 알림을 듣는다. 해제는 dispose다. */
  listen(): void {
    this.#disposers.push(
      this.files.onChanged((change) => {
        for (const listener of this.#watchers.get(change.path) ?? []) {
          listener(change);
        }
      }),
      this.files.onCloseRequest((request) => {
        void this.closeWindow((answer) =>
          this.files.answerClose(request, answer),
        ).then((answer) => this.files.answerClose(request, answer));
      }),
    );
  }

  dispose(): void {
    for (const dispose of this.#disposers) dispose();
    this.#disposers = [];
  }

  /** 이 파일에 저장이 끝나지 않은 고침이 있다(탭의 ●, preview 탭 고정). */
  isUnsettled(path: string): boolean {
    return this.#entries.get(path)?.session.unsettled() ?? false;
  }

  /** 어느 파일이든 저장 상태가 바뀌면 부른다. 해제는 반환 함수다. */
  onUnsettledChange(listener: () => void): () => void {
    this.#unsettledListeners.add(listener);
    return () => this.#unsettledListeners.delete(listener);
  }

  /** 이 파일이 밖에서 바뀌는지 본다. 해제는 반환 함수다. */
  watch(path: string, listener: (change: FileChanged) => void): () => void {
    let set = this.#watchers.get(path);
    if (set === undefined) {
      set = new Set();
      this.#watchers.set(path, set);
    }
    set.add(listener);
    void this.files.watch({ paths: [...this.#watchers.keys()] });
    this.#report();
    return () => {
      const current = this.#watchers.get(path);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size > 0) return;
      this.#watchers.delete(path);
      void this.files.watch({ paths: [...this.#watchers.keys()] });
      this.#report();
    };
  }

  /**
   * 파일을 글로 연다. 이미 이 창에 열린 session이 있으면 그것을 이어 쓴다. create면 없는 파일을
   * 빈 buffer로 열고 첫 저장이 만든다.
   */
  attach(
    path: string,
    name: string,
    create: boolean,
  ): Promise<OpenedSession | OpenFailure> {
    const live = this.#entries.get(path);
    if (live) {
      live.views += 1;
      return Promise.resolve({
        session: live.session,
        text: live.session.text,
      });
    }
    const pending = this.#opening.get(path);
    if (pending) {
      return pending.then((opened) => {
        if (typeof opened !== "string") {
          const entry = this.#entries.get(path);
          if (entry) entry.views += 1;
        }
        return opened;
      });
    }
    const opening = this.#open(path, name, create).finally(() =>
      this.#opening.delete(path),
    );
    this.#opening.set(path, opening);
    return opening;
  }

  async #open(
    path: string,
    name: string,
    create: boolean,
  ): Promise<OpenedSession | OpenFailure> {
    const reply = await this.files.read({ path });
    let text: string;
    let hash: string | null;
    if (reply.ok) {
      text = reply.value.text;
      hash = reply.value.hash;
    } else if (create && reply.code === "not_found") {
      text = "";
      hash = null;
    } else {
      return reply.code;
    }
    const port: SavePort = {
      write: (input) => this.files.write({ path, ...input }),
      read: () => this.files.read({ path }),
    };
    const session = new SaveSession({ port, text, hash });
    const stopWatch = this.watch(path, (change) => {
      void session.external(change.hash);
    });
    const stopListen = session.subscribe(() => this.#changed(path));
    this.#entries.set(path, {
      session,
      name,
      views: 1,
      release: () => {
        stopListen();
        stopWatch();
      },
    });
    return { session, text };
  }

  /** 화면이 그 파일을 떠났다. 마지막 고침을 보내고, 저장이 끝나면 놓는다. */
  detach(path: string): void {
    const entry = this.#entries.get(path);
    if (!entry) return;
    entry.views = Math.max(0, entry.views - 1);
    if (entry.views > 0) return;
    void entry.session.flush().then(() => this.#changed(path));
  }

  /**
   * 그 파일의 마지막 고침을 지금 쓴다. session이 없으면 true. 디스크가 편집기 글을 가졌을 때만
   * true다(쓰기 실패·충돌·결과 불명이면 false이고 글은 session에 남는다). 사람에게 묻지 않고
   * 화면 수도 건드리지 않는다(탭이 아직 mount된 채 창 사이 이동에 쓴다).
   */
  async flush(path: string): Promise<boolean> {
    const entry = this.#entries.get(path);
    if (!entry) return true;
    const settled = await entry.session.flush();
    this.#changed(path);
    return settled;
  }

  /**
   * 탭 닫기. 마지막 고침을 보낸다. 실패·불명·충돌이 남으면 사람에게 묻고 계속 편집을 고르면
   * false다(탭을 남긴다).
   */
  async leave(path: string): Promise<boolean> {
    const entry = this.#entries.get(path);
    if (!entry) return true;
    for (;;) {
      await entry.session.flush();
      if (!entry.session.unsettled()) return true;
      const choice = await this.#asker.ask(entry.name);
      if (choice === "keep") return false;
      if (choice === "discard") {
        entry.session.discard();
        this.#changed(path);
        return true;
      }
      await entry.session.retry();
    }
  }

  /** 명시 폐기. 사람이 잃기를 이미 확인한 파일(여러 탭 닫기)의 남은 고침을 버린다. */
  discard(path: string): void {
    const entry = this.#entries.get(path);
    if (!entry) return;
    entry.session.discard();
    this.#changed(path);
  }

  /** 창 닫기. 모든 session을 끝내고 남은 것이 있으면 한 번에 묻는다. */
  async closeWindow(
    progress: (answer: CloseAnswer) => void = () => {},
  ): Promise<CloseAnswer> {
    const entries = [...this.#entries.values()];
    await Promise.all(entries.map((entry) => entry.session.flush()));
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
        await entry.session.retry();
        await entry.session.flush();
      }
    }
  }

  /** 이 창의 저장 중 수와 열린 파일 수(끄기·창 닫기 확인). */
  counts(): FileCounts {
    let unsettled = 0;
    for (const entry of this.#entries.values()) {
      if (entry.session.unsettled()) unsettled += 1;
    }
    return { unsettled, open: this.#watchers.size };
  }

  #changed(path: string): void {
    const entry = this.#entries.get(path);
    if (entry && entry.views === 0 && !entry.session.unsettled()) {
      // 아무 화면도 보지 않고 저장도 끝났다.
      this.#entries.delete(path);
      entry.release();
      entry.session.dispose();
    }
    this.#report();
    for (const listener of this.#unsettledListeners) listener();
  }

  #report(): void {
    const next = this.counts();
    if (
      next.unsettled === this.#reported.unsettled &&
      next.open === this.#reported.open
    )
      return;
    this.#reported = next;
    this.files.counts(next);
  }
}
