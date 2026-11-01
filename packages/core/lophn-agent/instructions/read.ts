import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { InstructionReadFile } from "../../../protocol/lophn-agent/mod.ts";
import type {
  InstructionFile,
  InstructionFiles,
  InstructionLayerKind,
} from "./model.ts";

// core 쪽 읽기 통로(GetInstructions)와 runtime 쪽 InstructionFiles 어댑터가 같은 인코딩을 쓰도록
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
    ...(file.name === undefined ? {} : { name: file.name }),
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
  return ok({
    ...(file.name === undefined ? {} : { name: file.name }),
    size_bytes: file.size_bytes,
    bytes,
  });
}

// 한 session의 InstructionFiles. core의 GetInstructions를 그 session으로 부르는 `call`만 받는다. 어느 project의
// 파일인지는 core가 session의 place로 정하므로 여기서 project를 보내지 않는다.
export function instructionFilesOverCore(
  session: Id<"ses">,
  call: (input: {
    session: Id<"ses">;
    layer: InstructionLayerKind;
    domain?: Id<"dom">;
  }) => Promise<Result<{ file: InstructionReadFile | null }>>,
): InstructionFiles {
  return {
    async read(layer, domain) {
      const read = await call({
        session,
        layer,
        ...(domain === undefined ? {} : { domain: domain as Id<"dom"> }),
      });
      if (!read.ok) return read;
      return read.value.file === null
        ? ok(null)
        : decodeInstructionFile(read.value.file);
    },
  };
}
