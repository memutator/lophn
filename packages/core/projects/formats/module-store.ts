// format module 묶음의 blob 보존과 hash 되찾기(documents/formats#R20).
// 묶음은 purpose `format_module`로 준비하고, 참조는 소유 변경과 같은
// transaction에서 owner의 `bundle` field에 등록된다. hash로 다시 찾기는
// blob 보존의 참조 행에서 시작하며, 없는 hash는 누락이다. 새 module로 대체하지 않는다.

import { err, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import {
  defineBlobField,
  type PreparedBlob,
  preparedBlobSchema,
} from "../../../protocol/storage/mod.ts";
import { BUILTIN_MODULE_HASH, moduleHash } from "./guest/module-hash.ts";
import type { ModuleLookup, StoredModule } from "./modules.ts";
import { builtinModule } from "./modules.ts";

// 묶음 blob의 목적 최대 크기. runner heap 한도와 별개로 묶음은 작다.
export const FORMAT_MODULE_MAX_BYTES = 16 * 1024 * 1024;

// Version이 가리키는 module 묶음의 blob field. 보존 등급 permanent다.
export const formatModuleField = defineBlobField({
  owner_kind: "format_module",
  field: "bundle",
  retention: { kind: "permanent" },
  general_read: true,
});

// Version이 참조하는 module의 blob 등록 입력. 준비 결과 그대로다.
export type FormatModuleRegistration = PreparedBlob;

export const formatModuleRegistrationSchema = preparedBlobSchema;

// blob에서 되찾은 묶음 바이트의 경계. 등록된 hash의 전체 묶음을 돌려 준다.
// 읽은 바이트의 hash는 등록된 참조의 것과 같아야 한다.
export type ModuleBytes = {
  read(hash: string): Promise<
    Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
  >;
};

// blob 보존에서 온 module을 hash로 되찾는다(R20). 내장 hash는 내장 StoredModule,
// 아니면 등록된 참조의 바이트다. 읽은 바이트의 hash가 참조와 다르면 누락이고,
// 최신 module로 대체하지 않는다.
export async function moduleFrom(
  hash: string,
  bytes: ModuleBytes,
): Promise<ModuleLookup> {
  if (hash === BUILTIN_MODULE_HASH) {
    return { found: true, module: await builtinModule() };
  }
  const read = await bytes.read(hash);
  if (!read.ok) return { found: false, reason: "missing" };
  if (read.value.hash !== hash) return { found: false, reason: "missing" };
  const bundle = new TextDecoder().decode(read.value.bytes);
  if (moduleHash(bundle) !== hash) return { found: false, reason: "missing" };
  const module: StoredModule = { hash, bundle };
  return { found: true, module };
}

// 참조 행이 없거나 바이트가 손상됐을 때의 구별된 누락 이유.
export function moduleMissing(reason: string): Result<never, LophnError> {
  return err({ code: "not_found", message: reason });
}
