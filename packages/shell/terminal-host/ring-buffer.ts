// 재연결용 raw 출력은 LF 10,000개, chunk 10,000개, 5 MiB 중 먼저 닿는 쪽까지 둔다.
// 오래된 완전한 chunk부터 빼고, 남은 큰 chunk는 문자 경계로 자른다.
// disk·ledger·blob·log에 쓰지 않는다.

const MAX_LINES = 10_000;
const MAX_BYTES = 5_242_880;
const MAX_CHUNKS = 10_000;

type Chunk = {
  seq: number;
  text: string;
  bytes: number;
  lines: number;
};

export class RingBuffer {
  readonly #chunks: Chunk[] = [];
  #bytes = 0;
  #lines = 0;
  #seq = 0;
  dropped = false;

  get outputSeq(): number {
    return this.#seq;
  }

  get size(): { bytes: number; lines: number } {
    return { bytes: this.#bytes, lines: this.#lines };
  }

  push(text: string): Chunk {
    const chunk = this.#make(text);
    this.#chunks.push(chunk);
    this.#bytes += chunk.bytes;
    this.#lines += chunk.lines;
    this.#trim();
    return chunk;
  }

  /** renderer가 다시 붙을 때 살아 있는 buffer만 돌려준다. */
  snapshot(after = 0): { chunks: Chunk[]; dropped: boolean } {
    let lo = 0;
    let hi = this.#chunks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.#chunks[mid]!.seq <= after) lo = mid + 1;
      else hi = mid;
    }
    return {
      chunks: this.#chunks.slice(lo).map((chunk) => ({ ...chunk })),
      dropped: this.dropped,
    };
  }

  /** 닫힌 탭은 힙에 출력을 남기지 않는다. */
  clear(): void {
    this.#chunks.length = 0;
    this.#bytes = 0;
    this.#lines = 0;
    this.dropped = false;
  }

  #make(text: string): Chunk {
    return {
      seq: ++this.#seq,
      text,
      bytes: new TextEncoder().encode(text).byteLength,
      lines: countLines(text),
    };
  }

  #trim(): void {
    while (
      this.#chunks.length > 1 &&
      (this.#lines > MAX_LINES ||
        this.#bytes > MAX_BYTES ||
        this.#chunks.length > MAX_CHUNKS)
    ) {
      const oldest = this.#chunks.shift();
      if (!oldest) break;
      this.#bytes -= oldest.bytes;
      this.#lines -= oldest.lines;
      this.dropped = true;
    }
    const only = this.#chunks[0];
    if (!only) return;
    if (only.bytes <= MAX_BYTES && only.lines <= MAX_LINES) return;
    const cut = cutToFit(only.text);
    if (cut === only.text) return;
    this.#bytes -= only.bytes;
    this.#lines -= only.lines;
    only.text = cut;
    only.bytes = new TextEncoder().encode(cut).byteLength;
    only.lines = countLines(cut);
    this.#bytes += only.bytes;
    this.#lines += only.lines;
    this.dropped = true;
  }
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

function cutToFit(text: string): string {
  const encoded = new TextEncoder().encode(text);
  const sliced = encoded.subarray(Math.max(0, encoded.byteLength - MAX_BYTES));
  let start = 0;
  while (
    start < sliced.length &&
    (sliced[start]! & 0b1100_0000) === 0b1000_0000
  ) {
    start++;
  }
  const decoded = new TextDecoder().decode(sliced.subarray(start));
  const parts = decoded.split("\n");
  if (parts.length <= MAX_LINES) return decoded;
  return parts.slice(parts.length - MAX_LINES).join("\n");
}
