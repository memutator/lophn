// 사람 파일 작업의 내부 IPC payload. 두 갈래다.
// - core → coordinator: 사람의 요청(FileTarget)과, 있다면 core가 ledger에서 읽은 working copy
//   근거. core는 바이트를 먼저 byte chunk frame으로 보내고 요청은 channel로 가리킨다.
// - coordinator → 준비 worker: 목표를 실제 root와 경로로 푼 요청. 바이트도 같은 방식이다.
// op 이름은 같은 곳(ipc.ts)에 있다. 이 파일은 payload의 모양과 검사만 둔다.
import { z } from "zod";
import {
  absolutePathSchema,
  filesDelete,
  filesRename,
  fileTargetSchema,
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
// 읽은 파일의 identity. 창을 읽을 때마다 파일이 그대로인지 가리는 근거다(core는 이 값을
// 해석하지 않고 헤더 응답을 그대로 되돌려 보낸다).
export const fileIdentitySchema = z.strictObject({
  device: z.number().int().min(0),
  inode: z.number().int().min(0),
  size: z.number().int().min(0),
  mtime_ms: z.number().min(0),
});
export type FileIdentity = z.infer<typeof fileIdentitySchema>;

// 읽는 창 하나의 크기 상한. 한 byte chunk frame(1 MiB) 안이고 core의 blob 읽기 창과 같다.
export const FILE_WINDOW_MAX_BYTES = 256 * 1024;

// `documents.file_read`: 파일의 헤더(hash·크기·identity)만 묻는다. 바이트는 `file_window`가
// 창 단위 byte frame으로 보낸다.
export const coreFileReadSchema = z.strictObject({ target: fileTargetSchema });
// `documents.file_window`: 헤더의 identity가 그대로인 파일의 한 창. 바이트는 core가 정한
// channel의 byte chunk frame으로 응답 전에 가고, 응답은 보낸 길이를 말한다.
export const coreFileWindowSchema = z.strictObject({
  target: fileTargetSchema,
  identity: fileIdentitySchema,
  offset: z.number().int().min(0),
  length: z.number().int().min(1).max(FILE_WINDOW_MAX_BYTES),
  channel: channelSchema,
});
export type CoreFileWindow = z.infer<typeof coreFileWindowSchema>;
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
  // 쓸 때의 임시 파일 폴더. 목표의 폴더를 쓸 수 없는 전역 지침 파일에만 있다.
  temp_root: absolutePathSchema.optional(),
});
export type FileLocation = z.infer<typeof fileLocationSchema>;

export const prepReadSchema = z.strictObject({ location: fileLocationSchema });
export const prepWindowSchema = z.strictObject({
  location: fileLocationSchema,
  identity: fileIdentitySchema,
  offset: z.number().int().min(0),
  length: z.number().int().min(1).max(FILE_WINDOW_MAX_BYTES),
  // 준비 worker가 바이트를 보낼 channel. 응답 전에 byte chunk frame으로 간다.
  channel: channelSchema,
});
export type PrepWindow = z.infer<typeof prepWindowSchema>;
// 등록된 지침 파일 하나의 읽기. dataRoot의 소유자가 파일 소유자의 기준이다.
export const prepInstructionReadSchema = z.strictObject({
  path: absolutePathSchema,
  data_root: absolutePathSchema,
  // 준비 worker가 바이트를 보낼 channel. 응답 전에 byte chunk frame으로 간다.
  channel: channelSchema,
});
export const INSTRUCTION_READ_MAX_BYTES = FILE_WINDOW_MAX_BYTES;

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

// 준비 worker 읽기 응답(헤더). 바이트는 싣지 않는다: 파일은 크기와 무관하게 창 단위 byte
// frame으로 읽는다(`prepWindowSchema`). 없는 파일은 exists=false다.
export type FileReadReply = {
  exists: boolean;
  hash: string | null;
  size: number;
  // 읽은 파일의 identity. 없는 파일은 null이다.
  identity: FileIdentity | null;
  meta: unknown;
};
