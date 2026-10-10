import { err, ok, type Result } from "../../base/mod.ts";
import {
  type InstructionLocation,
  instructionRead,
  type InstructionReadFile,
} from "../../contracts/lophn-agent/mod.ts";
import type { ApiReadDefinition, Input } from "../../contracts/platform/mod.ts";
import type { InstructionFile, InstructionFiles } from "./model.ts";

// core 쪽 읽기 통로(ReadInstructionFile)와 runtime 쪽 InstructionFiles 어댑터다. 지침 파일의 정본 읽기는
// core가 하고(documents의 확정 판과 blob), agent runtime child는 ledger를 열지 않으므로 이 읽기 하나로만
// 받는다. 두 쪽이 같은 인코딩을 쓰도록 base64 변환을 여기에 둔다(R4, R5, R8).

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
    document: file.document,
    version: file.version,
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
    document: file.document,
    version: file.version,
    size_bytes: file.size_bytes,
    bytes,
  });
}

// ReadInstructionFile. machine만 읽는다(route의 actors). 대상은 등록 자리 하나나 preset에 붙은 문서
// 하나이고, 읽은 판은 읽는 순간의 확정 판이다. `asOfSeq`는 읽은 때의 ledger 위치다.
export function instructionReadApi(environment: {
  files: InstructionFiles;
  // 그 run이 읽을 수 있는 자리·문서인지 정한다. 아니면 not_found다(없는 대상과 같은 답).
  permit(input: Input<typeof instructionRead>): Result<void>;
  asOfSeq(): Result<string>;
}): ApiReadDefinition<typeof instructionRead> {
  return {
    route: instructionRead,
    async handle(_ctx, input) {
      const permitted = environment.permit(input);
      if (!permitted.ok) return permitted;
      const found = "location" in input
        ? await environment.files.registered(
          input.location as InstructionLocation,
        )
        : await environment.files.attached(input.document);
      if (!found.ok) return found;
      const asOf = environment.asOfSeq();
      if (!asOf.ok) return asOf;
      return ok({
        file: found.value === null ? null : encodeInstructionFile(found.value),
        as_of_seq: asOf.value,
        next_cursor: null,
      });
    },
  };
}

// 한 run의 InstructionFiles. core의 ReadInstructionFile을 그 run으로 부르는 `call`만 받는다. 앱과 project의
// 관계는 아직 어느 contract도 내놓지 않아 모른다(null).
export function instructionFilesOverCore(
  run: string,
  call: (
    input:
      | { run: string; location: InstructionLocation }
      | { run: string; document: string },
  ) => Promise<Result<{ file: InstructionReadFile | null }>>,
): InstructionFiles {
  return {
    async registered(location) {
      const read = await call({ run, location });
      if (!read.ok) return read;
      return read.value.file === null
        ? ok(null)
        : decodeInstructionFile(read.value.file);
    },
    async attached(document) {
      const read = await call({ run, document });
      if (!read.ok) return read;
      if (read.value.file === null) {
        return err({ code: "unavailable", message: "지침 본문이 없다" });
      }
      return decodeInstructionFile(read.value.file);
    },
    projectOf: () => Promise.resolve(ok(null)),
  };
}
