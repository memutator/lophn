// 사람 파일 작업의 내부 IPC payload. 두 갈래다.
// - core → coordinator: 사람의 요청(FileTarget)과, 있다면 core가 ledger에서 읽은 working copy
//   근거. core는 바이트를 먼저 byte chunk frame으로 보내고 요청은 channel로 가리킨다.
// - coordinator → 준비 worker: 목표를 실제 root와 경로로 푼 요청. 바이트도 같은 방식이다.
// op 이름은 같은 곳(ipc.ts)에 있다. 이 파일은 payload의 모양과 검사만 둔다.
import { z } from "zod";
import {
  absolutePathSchema,
  fileTargetSchema,
  filesDelete,
  filesRename,
  fileWriteRequestSchema,
  versionIdSchema,
} from "../../contracts/documents/mod.ts";
import { sha256Schema } from "../../contracts/platform/mod.ts";

const channelSchema = z.number().int().min(1).max(0xffffffff);
const contentRefSchema = z.strictObject({
  channel: channelSchema,
  bytes: z.number().int().min(0),
  hash: sha256Schema,
});
export type ContentRef = z.infer<typeof contentRefSchema>;

// core가 ledger에서 읽은 working copy 근거. 사람이 보낸 값이 아니다.
export const workingCopyBasisSchema = z.strictObject({
  base_version: versionIdSchema,
  primary_path: z.string().min(1),
  media_type: z.string().min(1),
  // 연 판의 대표 파일 hash. 사본의 첫 "마지막 확정 내용"이다.
  confirmed_hash: sha256Schema,
});
export type WorkingCopyBasis = z.infer<typeof workingCopyBasisSchema>;

export const coreFileWriteSchema = z.strictObject({
  request: fileWriteRequestSchema,
  content: contentRefSchema,
  working_copy: workingCopyBasisSchema.optional(),
});
export type CoreFileWrite = z.infer<typeof coreFileWriteSchema>;

export const coreFileRenameSchema = z.strictObject({
  request: filesRename.input,
});
export const coreFileDeleteSchema = z.strictObject({
  request: filesDelete.input,
});
export const coreFileReadSchema = z.strictObject({ target: fileTargetSchema });
export const coreFileWatchSchema = z.strictObject({
  target: fileTargetSchema,
  cursor: z.string().min(1).optional(),
});
export const coreWorkingCopyConfirmSchema = z.strictObject({
  document: z.string().min(1),
  base_version: versionIdSchema,
  confirmed_hash: sha256Schema,
});

// coordinator → 준비 worker. root는 등록 root(또는 working copy 폴더), path는 그 안의 파일이다.
export const fileLocationSchema = z.strictObject({
  root: absolutePathSchema,
  path: absolutePathSchema,
  // working copy의 metadata 파일. 있으면 읽기가 함께 돌려준다.
  meta: absolutePathSchema.optional(),
});
export type FileLocation = z.infer<typeof fileLocationSchema>;

export const prepReadSchema = z.strictObject({ location: fileLocationSchema });
export const prepWriteSchema = z.strictObject({
  location: fileLocationSchema,
  base_hash: sha256Schema.nullable(),
  content: contentRefSchema,
  // 새 working copy의 metadata. 파일 쓰기가 성공한 뒤 없을 때만 만든다.
  meta_create: z.string().min(1).optional(),
});
export type PrepWrite = z.infer<typeof prepWriteSchema>;
export const prepRenameSchema = z.strictObject({
  root: absolutePathSchema,
  path: absolutePathSchema,
  new_path: absolutePathSchema,
  base_hash: sha256Schema,
});
export const prepDeleteSchema = z.strictObject({
  root: absolutePathSchema,
  path: absolutePathSchema,
  base_hash: sha256Schema,
});
export const prepConfirmSchema = z.strictObject({
  root: absolutePathSchema,
  meta: absolutePathSchema,
  base_version: versionIdSchema,
  confirmed_hash: sha256Schema,
});

// 준비 worker 읽기 응답. 큰 파일은 bytes_b64가 null이다(한 응답 frame 한도).
export type FileReadReply = {
  exists: boolean;
  hash: string | null;
  size: number;
  bytes_b64: string | null;
  meta: unknown;
};

// 한 응답 JSON frame은 1 MiB다. base64가 4/3로 늘어나므로 읽기 상한은 그 안이다.
export const FILE_READ_MAX_BYTES = 512 * 1024;
