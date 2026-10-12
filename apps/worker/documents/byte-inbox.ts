// 요청 앞에 도착한 byte chunk frame을 channel별로 모으는 우편함. format 검사 입력(coordinator)과
// 사람 파일 쓰기 내용(coordinator, 준비 worker)이 함께 쓴다.
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { Frame } from "../../../packages/protocol/platform/mod.ts";
import { VALIDATE_INPUT_MAX_BYTES } from "../../../packages/core/projects/file-tracking/mod.ts";

// 요청 앞에 도착한 바이트를 channel별로 모은다. 요청이 가져가면 비운다. 요청이 오지 않은
// channel(중간에 끊긴 core)이 쌓이지 않도록 오래된 channel부터 버린다.
export type ByteInbox = {
  collect(frame: Frame): void;
  // channel의 바이트를 정확히 `bytes`만큼 가져간다. 모자라거나 넘치면 err다.
  take(channel: number, bytes: number): Result<Uint8Array>;
};

const INBOX_CHANNELS = 8;

export function createByteInbox(
  maxChannels: number = INBOX_CHANNELS,
): ByteInbox {
  const channels = new Map<
    number,
    { chunks: Uint8Array[]; size: number; overflow: boolean }
  >();
  return {
    collect(frame) {
      if (frame.kind !== "bytes") return;
      let held = channels.get(frame.channel);
      if (held === undefined) {
        held = { chunks: [], size: 0, overflow: false };
        channels.set(frame.channel, held);
        // 가장 오래된 channel부터 버린다(Map은 삽입 순서다).
        while (channels.size > maxChannels) {
          const oldest = channels.keys().next().value;
          if (oldest === undefined) break;
          channels.delete(oldest);
        }
      }
      if (held.overflow) return;
      if (held.size + frame.payload.length > VALIDATE_INPUT_MAX_BYTES) {
        held.overflow = true;
        held.chunks = [];
        return;
      }
      held.chunks.push(frame.payload);
      held.size += frame.payload.length;
    },
    take(channel, bytes) {
      const held = channels.get(channel);
      channels.delete(channel);
      if (bytes === 0 && held === undefined) return ok(new Uint8Array());
      if (held === undefined || held.overflow || held.size !== bytes) {
        return err({
          code: "unavailable",
          message: "validation input did not arrive",
        });
      }
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of held.chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      return ok(joined);
    },
  };
}
