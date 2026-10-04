import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../contracts/platform/mod.ts";

export type ByteReader = {
  read(buffer: Uint8Array): Promise<number | null>;
};

export type ByteWriter = {
  write(bytes: Uint8Array): Promise<number>;
};

// Electron main↔core와 신뢰 child가 같은 읽기·쓰기를 쓰도록 stream만 받는다.
export async function writeFrame(writer: ByteWriter, frame: Frame) {
  const bytes = encodeFrame(frame);
  let offset = 0;
  while (offset < bytes.length) {
    const written = await writer.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("frame write made no progress");
    offset += written;
  }
}

export function writeJson(writer: ByteWriter, payload: unknown) {
  return writeFrame(writer, { kind: "json", channel: 0, payload });
}

export function writeBytes(
  writer: ByteWriter,
  channel: number,
  payload: Uint8Array,
) {
  return writeFrame(writer, { kind: "bytes", channel, payload });
}

// frame이 아닌 바이트는 FrameDecoder가 throw한다. 호출자가 protocol 위반으로 다룬다.
// 한 번에 읽은 chunk 안의 frame은 버리지 않고 전부 넘긴다.
export async function* readFrames(
  reader: ByteReader,
): AsyncGenerator<Frame, "eof" | "closed"> {
  const decoder = new FrameDecoder();
  const buffer = new Uint8Array(64 * 1024);
  while (true) {
    const count = await reader.read(buffer);
    if (count === null) {
      decoder.finish();
      return "eof";
    }
    if (count === 0) return "closed";
    for (const frame of decoder.push(buffer.subarray(0, count))) yield frame;
  }
}
