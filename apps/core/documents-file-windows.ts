// coordinator가 파일 읽기의 한 창으로 보내는 byte chunk frame을 받는 core 쪽 우편함
// (documents#T12, `files.read`). core가 창 하나를 요청하기 전에 channel을 열고, coordinator가
// 응답 전에 그 channel로 바이트를 보내고(같은 pipe의 순서), 응답이 오면 가져간다. 열려 있지
// 않은 channel의 frame은 버린다(blob 준비 channel과 섞이지 않는다). 한 창의 상한을 넘는
// 바이트는 받지 않아 core 메모리는 열린 창 몇 개를 넘지 않는다.
import type { Frame } from "../../packages/protocol/platform/mod.ts";
import { FILE_WINDOW_MAX_BYTES } from "../../packages/core/projects/file-tracking/file-ipc.ts";

// coordinator→core의 blob 준비 channel(coordinator가 1부터 센다)과 겹치지 않는 영역에서 센다.
const CHANNEL_BASE = 0x40000000;
const CHANNEL_SPAN = 0x20000000;

export type FileWindow = {
  readonly channel: number;
  // 정확히 `bytes`만큼 받았으면 그 바이트, 아니면 undefined다. 한 번만 가져간다.
  take(bytes: number): Uint8Array | undefined;
  // 창이 끝났다(가져갔든 실패했든). 이어 오는 frame은 버린다.
  close(): void;
};

export type FileWindows = {
  open(): FileWindow;
  // coordinator 감독 pipe의 byte frame. 열린 channel의 것만 모은다.
  onFrame(frame: Frame): void;
  readonly openCount: number;
};

type Held = { chunks: Uint8Array[]; size: number; overflow: boolean };

export function createFileWindows(): FileWindows {
  const held = new Map<number, Held>();
  let counter = 0;
  return {
    open() {
      let channel = CHANNEL_BASE + counter;
      counter = (counter + 1) % CHANNEL_SPAN;
      while (held.has(channel)) {
        channel = CHANNEL_BASE + counter;
        counter = (counter + 1) % CHANNEL_SPAN;
      }
      held.set(channel, { chunks: [], size: 0, overflow: false });
      return {
        channel,
        take(bytes) {
          const window = held.get(channel);
          held.delete(channel);
          if (
            window === undefined || window.overflow || window.size !== bytes
          ) return undefined;
          const joined = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of window.chunks) {
            joined.set(chunk, offset);
            offset += chunk.length;
          }
          return joined;
        },
        close() {
          held.delete(channel);
        },
      };
    },
    onFrame(frame) {
      if (frame.kind !== "bytes") return;
      const window = held.get(frame.channel);
      if (window === undefined || window.overflow) return;
      if (window.size + frame.payload.length > FILE_WINDOW_MAX_BYTES) {
        window.overflow = true;
        window.chunks = [];
        return;
      }
      window.chunks.push(frame.payload);
      window.size += frame.payload.length;
    },
    get openCount() {
      return held.size;
    },
  };
}
