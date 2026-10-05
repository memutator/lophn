// 앱 자식의 stdout/stderr를 줄 단위로 읽는 streaming decoder. 줄바꿈이 없는 출력도
// byte 상한 안에서만 쥐고 있고, 상한을 넘은 줄은 redaction 전에 자르지 않고
// 통째로 버린다. 잘린 secret 일부가 새지 않는다는 안전성을 모르기 때문이다(R26).

// 한 줄이 redaction을 받기 전에 메모리에 머무를 수 있는 byte 상한이다.
export const LOG_PENDING_LINE_MAX_BYTES = 16 * 1024;

export type StreamDecoderDeps = {
  // 줄바꿈 없이 끝난 줄과 완성한 줄. 줄바꿈 문자는 뗀다.
  onLine: (line: string) => void;
  // 상한을 넘겨 버린 줄. 한 줄에 한 번만 부른다.
  onDropped: () => void;
  maxLineBytes?: number;
};

export type StreamDecoder = {
  push(bytes: Uint8Array): void;
  // 스트림이 끝났다. 줄바꿈 없이 끝난 꼬리를 한 줄로 낸다.
  finish(): void;
};

const NEWLINE = 0x0a;

// 줄바꿈 byte(0x0a)는 UTF-8 안에서 다른 문자의 일부가 아니므로 byte에서 나눠도 안전하다.
export function createStreamDecoder(deps: StreamDecoderDeps): StreamDecoder {
  const max = deps.maxLineBytes ?? LOG_PENDING_LINE_MAX_BYTES;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  // 상한을 넘은 줄은 다음 줄바꿈까지 버린다.
  let discarding = false;

  function emit(): void {
    const joined = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const part of pending) {
      joined.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingBytes = 0;
    const text = decoder.decode(joined);
    deps.onLine(text.endsWith("\r") ? text.slice(0, -1) : text);
  }

  function take(part: Uint8Array): void {
    if (discarding || part.length === 0) return;
    if (pendingBytes + part.length > max) {
      pending = [];
      pendingBytes = 0;
      discarding = true;
      deps.onDropped();
      return;
    }
    pending.push(part);
    pendingBytes += part.length;
  }

  return {
    push(bytes) {
      let start = 0;
      while (start < bytes.length) {
        const newline = bytes.indexOf(NEWLINE, start);
        if (newline < 0) {
          take(bytes.slice(start));
          return;
        }
        take(bytes.slice(start, newline));
        if (discarding) discarding = false;
        else emit();
        start = newline + 1;
      }
    },
    finish() {
      if (!discarding && pendingBytes > 0) emit();
      pending = [];
      pendingBytes = 0;
      discarding = false;
    },
  };
}

export type ByteSource = {
  // EOF면 null이다. SpawnedPipe와 같은 모양이다.
  read(buffer: Uint8Array): Promise<number | null>;
};

// source가 끝날 때까지 비동기로 읽어 decoder에 넘긴다. 읽기 실패는 끝으로 본다.
export async function drain(
  source: ByteSource,
  decoder: StreamDecoder,
  chunkBytes = 8 * 1024,
): Promise<void> {
  const buffer = new Uint8Array(chunkBytes);
  try {
    while (true) {
      const count = await source.read(buffer);
      if (count === null) break;
      decoder.push(buffer.subarray(0, count));
    }
  } catch {
    // pipe 오류는 읽기의 끝이다. 읽은 줄은 그대로 남긴다.
  } finally {
    decoder.finish();
  }
}
