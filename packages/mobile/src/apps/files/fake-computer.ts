// A computer's side of `app_files/put` and `app_files/read` for the phone's tests: it holds bytes the way the core's store does
// (an empty piece asks, pieces must follow, a complete file answers `have`), without a disk.
import type { Remote } from "../local/ports.ts";
import { fromBase64, toBase64 } from "../local/transfer.ts";

export type FakeFiles = {
  remote: Remote;
  /** Complete files by hash. */
  files: Map<string, Uint8Array>;
  /** Bytes of files being received. */
  parts: Map<string, number[]>;
  /** Every `app_files/put` as `[offset, bytes]`, in order. */
  puts: [number, number][];
  /** Files this computer refuses for good (the bytes are not their name). */
  refuse: Set<string>;
  /** The link breaks (an `unavailable`) on the next put that carries bytes, this many times. */
  breaks: number;
};

export function fakeFiles(inner?: Remote): FakeFiles {
  const state: FakeFiles = {
    files: new Map(),
    parts: new Map(),
    puts: [],
    refuse: new Set(),
    breaks: 0,
    remote: {
      async call(input) {
        if (input.resource !== "app_files") {
          return inner ? inner.call(input) : { ok: false, error: { code: "not_found", message: "no route" } };
        }
        const body = input.body as {
          file: string;
          size: number;
          offset: number;
          bytes_base64: string;
          length?: number;
        };
        if (input.method === "read") {
          const bytes = state.files.get(body.file);
          if (bytes === undefined) return { ok: false, error: { code: "not_found", message: "file not found" } };
          const piece = bytes.subarray(body.offset, body.offset + (body.length ?? 0));
          return {
            ok: true,
            value: { type: "image/jpeg", size: bytes.byteLength, bytes_base64: toBase64(piece) },
          };
        }
        const bytes = fromBase64(body.bytes_base64);
        state.puts.push([body.offset, bytes.byteLength]);
        if (state.files.has(body.file)) return { ok: true, value: { status: "have", received: body.size } };
        if (state.refuse.has(body.file)) {
          return {
            ok: false,
            error: {
              code: "invalid_input",
              message: "the file does not match its sha256 or size",
              details: { received: 0, reason: "mismatch" },
            } as never,
          };
        }
        const part = state.parts.get(body.file) ?? [];
        if (bytes.byteLength === 0 && body.size > 0) {
          return { ok: true, value: { status: "partial", received: part.length } };
        }
        if (state.breaks > 0) {
          state.breaks--;
          return { ok: false, error: { code: "unavailable", message: "the link dropped" } };
        }
        if (body.offset !== part.length) {
          return {
            ok: false,
            error: {
              code: "invalid_input",
              message: "offset does not continue",
              details: { received: part.length },
            } as never,
          };
        }
        for (const byte of bytes) part.push(byte);
        state.parts.set(body.file, part);
        if (part.length < body.size) return { ok: true, value: { status: "partial", received: part.length } };
        state.files.set(body.file, new Uint8Array(part));
        state.parts.delete(body.file);
        return { ok: true, value: { status: "stored", received: part.length } };
      },
    },
  };
  return state;
}
