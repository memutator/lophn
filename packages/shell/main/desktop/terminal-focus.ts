/**
 * 사람이 고른 터미널 탭의 webContents 표. 탭 화면이 focus·blur에 쓰고, main은 입력·restart 검사와 알림(보고 있는가)에
 * 본다. 표에 없는 터미널의 입력은 core로 가지 않는다.
 */
export class TerminalFocusTable {
  readonly #focused = new Map<
    string,
    { contents: number; generation: number | undefined }
  >();

  /** 사람이 그 터미널 탭을 골랐다. webContents id는 그때의 frame이고 generation은 renderer가 본 runtime이다. */
  focus(contentsId: number, terminal: string, generation?: number): void {
    this.#focused.set(terminal, { contents: contentsId, generation });
  }

  /** 탭을 떠났다. 그 webContents의 표시만 지운다. */
  blur(contentsId: number, terminal: string): void {
    if (this.#focused.get(terminal)?.contents === contentsId) {
      this.#focused.delete(terminal);
    }
  }

  /** 창이 닫혔다. 그 webContents가 고른 탭을 모두 놓는다. */
  forget(contentsId: number): void {
    for (const [terminal, entry] of [...this.#focused]) {
      if (entry.contents === contentsId) this.#focused.delete(terminal);
    }
  }

  /** 그 탭을 골라 둔 창의 webContents id. 고른 창이 없으면 undefined. */
  contentsOf(terminal: string): number | undefined {
    return this.#focused.get(terminal)?.contents;
  }

  /** generation을 주면 renderer가 focus를 알린 그 generation일 때만 맞다. */
  focused(contentsId: number, terminal: string, generation?: number): boolean {
    const entry = this.#focused.get(terminal);
    if (!entry || entry.contents !== contentsId) return false;
    return (
      generation === undefined ||
      entry.generation === undefined ||
      entry.generation === generation
    );
  }
}
