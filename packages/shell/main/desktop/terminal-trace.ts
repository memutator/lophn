import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// 터미널 진단 기록 file(`<dir>/terminal-trace.jsonl`). 한도(10 MiB)를 넘기 전에 `terminal-trace.1.jsonl`로 넘겨
// 둘만 남긴다(shell은 core를 import하지 못해 core의 log file 회전을 쓰지 못한다). 쓰기는 차례로 하고 실패는 버린다.
const MAX_BYTES = 10 * 1024 * 1024;

export function createTraceFile(
  dir: string,
  maxBytes: number = MAX_BYTES,
): { append(text: string): void } {
  const current = join(dir, "terminal-trace.jsonl");
  const previous = join(dir, "terminal-trace.1.jsonl");
  let size: number | undefined;
  let writes = Promise.resolve();

  async function write(text: string): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    size ??= await stat(current).then(
      (info) => info.size,
      () => 0,
    );
    const bytes = Buffer.byteLength(text);
    if (size > 0 && size + bytes > maxBytes) {
      await rm(previous, { force: true });
      await rename(current, previous);
      size = 0;
    }
    await appendFile(current, text, { mode: 0o600 });
    size += bytes;
  }

  return {
    append(text) {
      writes = writes.then(() => write(text)).catch(() => {});
    },
  };
}
