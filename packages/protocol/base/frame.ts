// core와 자식 process 사이 pipe의 frame 형식과 codec이다.
const FRAME_KINDS = { json: 1, bytes: 2, end: 3, abort: 4 } as const;
export const STREAM_CHUNK_MAX_BYTES = 1024 * 1024;
export const CONTROL_MAX_BYTES = 256 * 1024;
// 앱 호출 응답이 core로 돌아가는 길이 control frame 하나라서 그 한도가 상한이다. envelope와 감싼 칸의
// 여유를 뺀다.
export const CALL_RESPONSE_MAX_BYTES = CONTROL_MAX_BYTES - 1024;
export type Frame =
  | { kind: "json"; channel: 0; payload: unknown }
  | { kind: "bytes"; channel: number; payload: Uint8Array }
  | { kind: "end" | "abort"; channel: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function validateHeader(length: number, kind: number, channel: number) {
  if (length < 5 || length > STREAM_CHUNK_MAX_BYTES + 5) {
    throw new Error("invalid frame length");
  }
  if (!Number.isInteger(kind) || kind < 1 || kind > 4) {
    throw new Error("unknown frame kind");
  }
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffffffff) {
    throw new Error("invalid frame channel");
  }
  if ((kind === 1) !== (channel === 0)) {
    throw new Error(
      "control requires channel 0; stream requires nonzero channel",
    );
  }
  if (kind === 1 && length > CONTROL_MAX_BYTES + 5) {
    throw new Error("control frame exceeds limit");
  }
  if (kind >= 3 && length !== 5) throw new Error("terminal frame has payload");
}

// 길이는 prefix 자체를 제외한 kind(1) + channel(4) + payload의 bytes다.
export function encodeFrame(frame: Frame): Uint8Array {
  const kind = FRAME_KINDS[frame.kind];
  const payload = frame.kind === "json"
    ? encoder.encode(JSON.stringify(frame.payload))
    : frame.kind === "bytes"
    ? frame.payload
    : new Uint8Array();
  validateHeader(5 + payload.length, kind, frame.channel);
  if (frame.kind === "json") JSON.parse(decoder.decode(payload));
  const bytes = new Uint8Array(9 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 5 + payload.length, false);
  view.setUint8(4, kind);
  view.setUint32(5, frame.channel, false);
  bytes.set(payload, 9);
  return bytes;
}

// header를 먼저 검사해서 공격자가 보낸 길이만큼 무제한 할당하지 않는다.
export class FrameDecoder {
  private header = new Uint8Array(9);
  private headerUsed = 0;
  private payload: Uint8Array | undefined;
  private payloadUsed = 0;
  private failed = false;

  push(bytes: Uint8Array): Frame[] {
    if (this.failed) throw new Error("frame decoder has failed");
    const frames: Frame[] = [];
    let offset = 0;
    try {
      while (offset < bytes.length) {
        if (!this.payload) {
          const count = Math.min(9 - this.headerUsed, bytes.length - offset);
          this.header.set(
            bytes.subarray(offset, offset + count),
            this.headerUsed,
          );
          this.headerUsed += count;
          offset += count;
          if (this.headerUsed >= 4) {
            const length = new DataView(this.header.buffer).getUint32(0, false);
            if (length < 5 || length > STREAM_CHUNK_MAX_BYTES + 5) {
              throw new Error("invalid frame length");
            }
          }
          if (this.headerUsed < 9) continue;
          const view = new DataView(this.header.buffer);
          const length = view.getUint32(0, false);
          validateHeader(length, view.getUint8(4), view.getUint32(5, false));
          this.payload = new Uint8Array(length - 5);
        }
        const count = Math.min(
          this.payload.length - this.payloadUsed,
          bytes.length - offset,
        );
        this.payload.set(
          bytes.subarray(offset, offset + count),
          this.payloadUsed,
        );
        this.payloadUsed += count;
        offset += count;
        if (this.payloadUsed !== this.payload.length) continue;
        const view = new DataView(this.header.buffer);
        const channel = view.getUint32(5, false);
        const kind = view.getUint8(4);
        if (kind === 1) {
          frames.push({
            kind: "json",
            channel: 0,
            payload: JSON.parse(decoder.decode(this.payload)),
          });
        } else if (kind === 2) {
          frames.push({ kind: "bytes", channel, payload: this.payload });
        } else {
          frames.push({ kind: kind === 3 ? "end" : "abort", channel });
        }
        this.headerUsed = 0;
        this.payload = undefined;
        this.payloadUsed = 0;
      }
      return frames;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  finish(): void {
    if (this.failed || this.headerUsed !== 0) {
      throw new Error("incomplete frame stream");
    }
  }
}
