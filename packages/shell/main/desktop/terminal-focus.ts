/**
 * 창(webContents)마다 사람이 고른 터미널 탭과 보이는 터미널의 표. 탭 화면이 focus·blur와 display의 붙음·놓음을 알리고, main은
 * 입력·restart·질의 응답 검사(`mayCall`)와 알림(보고 있는가)에 본다. 표가 허락하지 않는 일은 core로 가지 않는다.
 */
export class TerminalFocusTable {
  readonly #focused = new Map<
    string,
    { contents: number; generation: number | undefined }
  >();
  readonly #shown = new Map<number, Set<string>>();

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

  /** 그 창의 display가 그 터미널에 붙었다. focus와 따로다: 숨은 탭의 xterm도 질의에 답한다. */
  show(contentsId: number, terminal: string): void {
    let shown = this.#shown.get(contentsId);
    if (shown === undefined) this.#shown.set(contentsId, (shown = new Set()));
    shown.add(terminal);
  }

  /** 그 창의 display가 그 터미널을 놓았다. */
  hide(contentsId: number, terminal: string): void {
    this.#shown.get(contentsId)?.delete(terminal);
  }

  shows(contentsId: number, terminal: string): boolean {
    return this.#shown.get(contentsId)?.has(terminal) ?? false;
  }

  /** 창이 닫혔다. 그 webContents가 고른 탭과 보이던 터미널을 모두 놓는다. */
  forget(contentsId: number): void {
    for (const [terminal, entry] of [...this.#focused]) {
      if (entry.contents === contentsId) this.#focused.delete(terminal);
    }
    this.#shown.delete(contentsId);
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

/**
 * 창이 터미널에 보내는 일을 core에 넘길지. 사람의 입력과 다시 시작은 그 창이 그 터미널에 focus를 가졌을 때(입력은 그 generation),
 * 질의 응답은 그 창이 그 터미널을 보일 때만이다. shell main은 이것을 통과한 일에만 자기 shell capability를 싣는다.
 */
export function mayCall(
  table: TerminalFocusTable,
  channel: "input" | "response" | "restart",
  contentsId: number,
  call: { terminal: string; generation?: number },
): boolean {
  if (channel === "response") return table.shows(contentsId, call.terminal);
  if (channel === "restart") return table.focused(contentsId, call.terminal);
  return table.focused(contentsId, call.terminal, call.generation);
}
