// 저장 준비의 format 검사(file-tracking#R5, versions#R4). core의 준비 route가 원문 바이트를
// 감독 pipe의 byte chunk frame으로 보내고, 같은 channel을 가리키는 `documents.validate_files`
// 요청을 보낸다. coordinator가 그 바이트를 format runner(권한 없는 QuickJS 호출 하나)에
// 넘기고, runner 출력을 host가 다시 검사한 결과를 돌려준다. 바이트는 이 호출 동안만
// 메모리에 있고 log·status에 남기지 않는다.
import { err, type Result, sha256Hex } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import {
  BUILTIN_FORMAT_NAMES,
  type BuiltinFormatName,
  formatChecksContent,
} from "../../../packages/contracts/documents/mod.ts";
import type { ValidateFilesRequest } from "../../../packages/documents/file-tracking/mod.ts";
import type { FormatCall } from "../../../packages/documents/formats/reads.ts";
import { type ByteInbox } from "./byte-inbox.ts";

export { type ByteInbox, createByteInbox } from "./byte-inbox.ts";

export type ValidationDeps = {
  inbox: ByteInbox;
  // format runner 호출. 제품은 `createFormatHandlers().call`이다.
  call(input: FormatCall): Promise<Result<unknown, LophnError>>;
};

function isBuiltin(name: string): name is BuiltinFormatName {
  return (BUILTIN_FORMAT_NAMES as readonly string[]).includes(name);
}

// 검사 하나. 입력 바이트는 한 번 가져가면 사라진다. 모르는 format 이름은 미지원이고
// 통과로 꾸미지 않는다.
export async function validateFiles(
  request: ValidateFilesRequest,
  deps: ValidationDeps,
): Promise<Result<unknown, LophnError>> {
  const files: {
    path: string;
    media_type: string;
    primary: boolean;
    content: readonly number[];
  }[] = [];
  // 바이트를 읽는 format의 대표 파일은 바이트가 와야 한다. 빈 입력으로 통과시키지 않는다.
  if (
    formatChecksContent(request.format.name) &&
    request.files.some((file) => file.primary && file.channel === null)
  ) {
    return err({
      code: "invalid_input",
      message: "format check needs the primary file bytes",
    });
  }
  let primaryBytes: Uint8Array | undefined;
  let primaryBlobHash: string | undefined;
  for (const file of request.files) {
    if (file.primary) primaryBlobHash = file.blob_hash;
    // channel이 없는 파일은 검사가 바이트를 읽지 않는다: 경로·MIME·대표 여부만 넘긴다.
    if (file.channel === null) {
      files.push({
        path: file.path,
        media_type: file.media_type,
        primary: file.primary,
        content: [],
      });
      continue;
    }
    const taken = deps.inbox.take(file.channel, file.bytes);
    if (!taken.ok) return taken;
    if (file.primary) primaryBytes = taken.value;
    files.push({
      path: file.path,
      media_type: file.media_type,
      primary: file.primary,
      content: Array.from(taken.value),
    });
  }
  if (!isBuiltin(request.format.name)) {
    return err({ code: "not_found", message: "format is not supported" });
  }
  // guest 입력의 input_hash는 대표 파일의 hash다. 준비 조립이 목록 hash로 다시 정한다.
  // 바이트를 받았으면 그 hash를, 보내지 않은 대표 파일은 요청의 blob hash를 쓴다.
  const inputHash = primaryBytes !== undefined
    ? await sha256Hex(primaryBytes)
    : primaryBlobHash ?? await sha256Hex(new Uint8Array());
  return await deps.call({
    operation: "validate",
    name: request.format.name,
    module_hash: request.format.module_hash,
    input: {
      input_hash: inputHash,
      module_hash: request.format.module_hash,
      files,
    },
  });
}
