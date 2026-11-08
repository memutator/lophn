// 재연결용 화면. raw 출력을 쌓아 다시 재생하지 않고, headless xterm이 파싱한 화면(scrollback 포함)을 두었다가
// 직렬화해 준다. raw를 한도까지 쌓으면 history를 한 번만 쓰고 그 뒤로 아래 viewport만 고쳐 그리는 TUI(omp는
// 초당 30여 chunk)가 몇 분 만에 한도를 채워 처음 그린 history를 밀어내고, 다시 붙은 화면이 빈다.
// disk·ledger·blob·log에 쓰지 않는다.

/// <reference path="./addon-serialize.d.ts" />
/// <reference path="./addon-unicode11.d.ts" />
import serialize from "@xterm/addon-serialize/lib/addon-serialize.js";
import unicode11 from "@xterm/addon-unicode11/lib/addon-unicode11.js";
import headless from "@xterm/headless";

/** renderer xterm의 scrollback과 같다. 그보다 오래된 줄은 보이는 화면에도 없다. */
const SCROLLBACK = 10_000;

// serialize는 mouse tracking(?1000·1002·1003)은 되살리지만 report 인코딩은 빠뜨린다. 그러면 다시 붙은 xterm이
// 기본 X10으로 보내고, X10 report는 onData가 아닌 onBinary로 나가 TUI(Claude Code, OpenCode)가 mouse를 하나도
// 못 받는다. 커서 숨김(?25l)도 빠뜨려 TUI 위에 커서가 남는다. 둘은 출력에서 직접 따라간다.
const MOUSE_ENCODINGS = [1005, 1006, 1015, 1016];

export class Screen {
  readonly #term: headless.Terminal;
  readonly #serializer: serialize.SerializeAddon;
  #seq = 0;
  #disposed = false;
  #mouseEncoding: number | null = null;
  #cursorHidden = false;

  constructor(columns: number, rows: number) {
    this.#term = new headless.Terminal({
      cols: columns,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    this.#serializer = new serialize.SerializeAddon();
    this.#term.loadAddon(this.#serializer);
    // 글자 폭은 renderer xterm과 같아야 다시 붙은 화면의 칸이 맞는다.
    this.#term.loadAddon(new unicode11.Unicode11Addon());
    this.#term.unicode.activeVersion = "11";
    const track = (set: boolean) => (params: (number | number[])[]) => {
      for (const param of params) {
        if (typeof param !== "number") continue;
        if (param === 25) this.#cursorHidden = !set;
        else if (MOUSE_ENCODINGS.includes(param)) {
          if (set) this.#mouseEncoding = param;
          else if (this.#mouseEncoding === param) this.#mouseEncoding = null;
        }
      }
      return false;
    };
    this.#term.parser.registerCsiHandler(
      { prefix: "?", final: "h" },
      track(true),
    );
    this.#term.parser.registerCsiHandler(
      { prefix: "?", final: "l" },
      track(false),
    );
    this.#term.parser.registerEscHandler({ final: "c" }, () => {
      this.#mouseEncoding = null;
      this.#cursorHidden = false;
      return false;
    });
  }

  /** scrollback 한도를 넘어 가장 오래된 줄을 버리기 시작했다. 파싱이 따라온 만큼만 안다. */
  get dropped(): boolean {
    if (this.#disposed) return false;
    const normal = this.#term.buffer.normal;
    return normal.length >= this.#term.rows + SCROLLBACK;
  }

  push(text: string): number {
    this.#seq += 1;
    if (!this.#disposed) this.#term.write(text);
    return this.#seq;
  }

  /** 앞서 쓴 출력은 옛 크기로 파싱한 뒤에 바꾼다. 그 뒤 출력이 새 크기로 그려졌기 때문이다. */
  resize(columns: number, rows: number): void {
    if (this.#disposed) return;
    this.#term.write("", () => {
      if (!this.#disposed) this.#term.resize(columns, rows);
    });
  }

  /**
   * 지금까지 push한 출력을 모두 파싱한 화면. seq는 그 마지막 chunk라 받는 쪽은 그 뒤 출력만 이어 쓴다.
   * write 큐는 순서대로 돌고 callback은 앞 chunk 바로 뒤에 불리므로, 그 안의 직렬화는 seq까지만 담는다.
   */
  snapshot(): Promise<{ seq: number; text: string }> {
    const seq = this.#seq;
    if (this.#disposed) return Promise.resolve({ seq, text: "" });
    return new Promise((resolve) => {
      this.#term.write("", () => {
        if (this.#disposed) return resolve({ seq, text: "" });
        const buffer = this.#term.buffer.active;
        // 줄 끝까지 쓴 줄(wrap 대기)에서 addon이 cursor를 한 칸 틀리게 돌린다. 절대 위치로 다시 둔다.
        const cursor = `\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`;
        const modes =
          (this.#mouseEncoding === null
            ? ""
            : `\x1b[?${this.#mouseEncoding}h`) +
          (this.#cursorHidden ? "\x1b[?25l" : "");
        resolve({
          seq,
          text:
            this.#serializer.serialize({ scrollback: SCROLLBACK }) +
            modes +
            cursor,
        });
      });
    });
  }

  /** 닫힌 탭은 힙에 출력을 남기지 않는다. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#term.dispose();
  }
}
