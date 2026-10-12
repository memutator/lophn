import { err, ok, type Result } from "../../../base/mod.ts";
import type { InstructionReadFile } from "../../../protocol/lophn-agent/mod.ts";
import type {
  InstructionFile,
  InstructionFiles,
  InstructionLayerKind,
} from "./model.ts";

// core 쪽 읽기 통로(ReadInstructionFile)와 runtime 쪽 InstructionFiles 어댑터가 같은 인코딩을 쓰도록
// base64 변환을 여기에 둔다. 지침 파일을 여는 것은 core(reader Worker)이고, agent runtime child는 파일도
// ledger도 열지 않으며 이 읽기 하나로만 받는다.

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function encodeInstructionFile(
  file: InstructionFile,
): InstructionReadFile {
  return {
    size_bytes: file.size_bytes,
    content_base64: toBase64(file.bytes),
  };
}

export function decodeInstructionFile(
  file: InstructionReadFile,
): Result<InstructionFile> {
  const bytes = fromBase64(file.content_base64);
  if (bytes === undefined) {
    return err({ code: "unavailable", message: "지침 본문을 읽지 못했다" });
  }
  return ok({ size_bytes: file.size_bytes, bytes });
}

// 한 run의 InstructionFiles. core의 ReadInstructionFile을 그 run으로 부르는 `call`만 받는다. 어느 자리의
// 파일인지는 core가 run의 작업 자리로 정하므로 여기서 자리 id를 보내지 않는다.
export function instructionFilesOverCore(
  run: string,
  call: (
    input: { run: string; layer: InstructionLayerKind },
  ) => Promise<Result<{ file: InstructionReadFile | null }>>,
): InstructionFiles {
  return {
    async read(layer) {
      const read = await call({ run, layer });
      if (!read.ok) return read;
      return read.value.file === null
        ? ok(null)
        : decodeInstructionFile(read.value.file);
    },
  };
}
