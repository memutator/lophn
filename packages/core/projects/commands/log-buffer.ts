import { stripAnsi } from "./url-detect.ts";

// 실행 중에는 최소 1,000줄 링버퍼, 종료 후에는 최대 200줄 / 32 KiB 꼬리를 보존한다(spec 3.3.2).
export const RUNNING_LOG_MAX_LINES = 1_000;
export const RETAINED_LOG_MAX_LINES = 200;
export const RETAINED_LOG_MAX_BYTES = 32 * 1024;

export class CommandLogBuffer {
  #lines: string[] = [];
  #partial = "";
  #truncated = false;
  #maxLines = RUNNING_LOG_MAX_LINES;

  push(chunk: string): void {
    const plain = stripAnsi(chunk).replace(/\r\n/g, "\n");
    const combined = this.#partial + plain;
    const parts = combined.split("\n");
    this.#partial = parts.pop() ?? "";
    for (const part of parts) {
      // 같은 줄 덮어쓰기(\r)는 마지막 구간만 남긴다.
      const line = part.includes("\r") ? (part.split("\r").at(-1) ?? "") : part;
      this.#lines.push(line);
    }
    if (this.#lines.length > this.#maxLines) {
      this.#lines = this.#lines.slice(-this.#maxLines);
      this.#truncated = true;
    }
  }

  // 종료 시 남은 partial을 줄로 확정하고 200줄 / 32 KiB 상한으로 자른다.
  compactToTail(): void {
    if (this.#partial !== "") {
      const line = this.#partial.includes("\r")
        ? (this.#partial.split("\r").at(-1) ?? "")
        : this.#partial;
      this.#lines.push(line);
      this.#partial = "";
    }
    this.#maxLines = RETAINED_LOG_MAX_LINES;
    if (this.#lines.length > RETAINED_LOG_MAX_LINES) {
      this.#lines = this.#lines.slice(-RETAINED_LOG_MAX_LINES);
      this.#truncated = true;
    }
    const kept: string[] = [];
    let bytes = 0;
    for (let i = this.#lines.length - 1; i >= 0; i -= 1) {
      const line = this.#lines[i]!;
      const size = Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
      if (bytes + size > RETAINED_LOG_MAX_BYTES) {
        if (kept.length === 0) {
          // 한 줄이 32 KiB를 넘으면 끝부분만 남긴다.
          kept.push(
            Buffer.from(line, "utf8")
              .subarray(-RETAINED_LOG_MAX_BYTES)
              .toString("utf8"),
          );
        }
        this.#truncated = true;
        break;
      }
      kept.push(line);
      bytes += size;
    }
    kept.reverse();
    this.#lines = kept;
  }

  read(limit?: number): { lines: string[]; truncated: boolean } {
    const all =
      this.#partial !== "" ? [...this.#lines, this.#partial] : [...this.#lines];
    if (limit !== undefined && all.length > limit) {
      return { lines: all.slice(-limit), truncated: true };
    }
    return { lines: all, truncated: this.#truncated };
  }
}
