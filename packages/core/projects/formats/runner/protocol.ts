// runner는 호출마다 프로세스 하나다. 요청 하나, 응답 하나, 종료.
import type { FormatKind } from "../guest.ts";
import type { FormatModuleInput } from "../pure/input.ts";

export type RunnerRequest = {
  operation: "validate" | "extract";
  name: FormatKind;
  module_hash: string;
  bundle: string;
  input: FormatModuleInput;
};

export type RunnerResponse =
  | { ok: true; output: unknown }
  | {
    ok: false;
    reason: "limit" | "crash" | "invalid_output" | "module_mismatch";
    detail: string;
  };

const HEADER = 4;

export function encodeMessage(payload: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const bytes = new Uint8Array(HEADER + body.length);
  new DataView(bytes.buffer).setUint32(0, body.length);
  bytes.set(body, HEADER);
  return bytes;
}

export async function readMessage(
  read: (buffer: Uint8Array) => Promise<number | null>,
): Promise<unknown> {
  const header = new Uint8Array(HEADER);
  await readExact(read, header);
  const length = new DataView(header.buffer).getUint32(0);
  const body = new Uint8Array(length);
  await readExact(read, body);
  return JSON.parse(new TextDecoder().decode(body));
}

async function readExact(
  read: (buffer: Uint8Array) => Promise<number | null>,
  buffer: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const n = await read(buffer.subarray(offset));
    if (n === null) throw new Error("runner stream closed");
    offset += n;
  }
}

export async function writeMessage(
  write: (bytes: Uint8Array) => Promise<number>,
  payload: unknown,
): Promise<void> {
  const bytes = encodeMessage(payload);
  let offset = 0;
  while (offset < bytes.length) {
    const n = await write(bytes.subarray(offset));
    if (!Number.isInteger(n) || n < 1) throw new Error("runner write stalled");
    offset += n;
  }
}
