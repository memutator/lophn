// 재연결용 화면. raw 출력을 쌓아 다시 재생하지 않고, headless xterm이 파싱한 화면(scrollback 포함)을 두었다가
// 직렬화해 준다. raw를 한도까지 쌓으면 history를 한 번만 쓰고 그 뒤로 아래 viewport만 고쳐 그리는 TUI(omp는
// 초당 30여 chunk)가 몇 분 만에 한도를 채워 처음 그린 history를 밀어내고, 다시 붙은 화면이 빈다.
// disk·ledger·blob·log에 쓰지 않는다.

/// <reference path="./addon-serialize.d.ts" />
import serialize from "@xterm/addon-serialize/lib/addon-serialize.js";
import headless from "@xterm/headless";

/** renderer xterm의 scrollback과 같다. 그보다 오래된 줄은 보이는 화면에도 없다. */
const SCROLLBACK = 10_000;

export class Screen {
  readonly #term: headless.Terminal;
  readonly #serializer: serialize.SerializeAddon;
  #seq = 0;
  #disposed = false;

  constructor(columns: number, rows: number) {
    this.#term = new headless.Terminal({
      cols: columns,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    this.#serializer = new serialize.SerializeAddon();
    this.#term.loadAddon(this.#serializer);
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
        resolve({
          seq,
          text: this.#serializer.serialize({ scrollback: SCROLLBACK }) + cursor,
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
