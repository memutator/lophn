// 원본 연결이 없는 문서의 작업 사본(file-tracking#R1). 선택한 판의 바이트로 시작하고 그
// 뒤의 미확정 편집을 `~/.lophn/documents/working-copies/<doc>/`에 보존한다. place·tracking
// 원본이 아니고 derived store의 자동 삭제 대상도 아니다. 새 최신 판과 충돌해도 이 폴더는
// 남는다. 이 파일은 위치와 작은 metadata의 모양만 정한다(순수).
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import { sha256Schema } from "../../../protocol/platform/mod.ts";
import {
  documentIdSchema,
  versionIdSchema,
} from "../../../protocol/projects/mod.ts";

export const WORKING_COPY_CONTENT = "content";
export const WORKING_COPY_META = "meta.json";

// 대표 파일 하나만 편집한다. 연 판·대표 파일·마지막으로 확정한 내용의 hash가 있어야
// 편집한 내용이 아직 판이 아닌지(version_pending) 가를 수 있다.
export const workingCopyMetaSchema = z.strictObject({
  document: documentIdSchema,
  base_version: versionIdSchema,
  primary_path: z.string().min(1),
  media_type: z.string().min(1),
  confirmed_hash: sha256Schema,
});
export type WorkingCopyMeta = z.infer<typeof workingCopyMetaSchema>;

export type WorkingCopyLocation = {
  // `documents/working-copies` 폴더. 이 안에 doc 폴더가 있다.
  parent: string;
  root: string;
  content: string;
  meta: string;
};

// doc ID 모양이 아닌 값은 경로로 쓰지 않는다. 폴더 이름이 항상 doc ID 하나다.
export function workingCopyLocation(
  dataRoot: string,
  document: string,
): Result<WorkingCopyLocation> {
  if (
    !dataRoot.startsWith("/") || !documentIdSchema.safeParse(document).success
  ) {
    return err({ code: "invalid_input", message: "invalid working copy" });
  }
  const base = dataRoot.endsWith("/") ? dataRoot.slice(0, -1) : dataRoot;
  const parent = `${base}/documents/working-copies`;
  const root = `${parent}/${document}`;
  return ok({
    parent,
    root,
    content: `${root}/${WORKING_COPY_CONTENT}`,
    meta: `${root}/${WORKING_COPY_META}`,
  });
}

export function encodeWorkingCopyMeta(meta: WorkingCopyMeta): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta));
}

export function parseWorkingCopyMeta(
  value: unknown,
): WorkingCopyMeta | undefined {
  const parsed = workingCopyMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// 사본의 현재 바이트가 마지막으로 확정한 내용과 같으면 tracked, 다르면 판 대기다.
export function workingCopyState(
  meta: WorkingCopyMeta,
  observedHash: string,
): "tracked" | "version_pending" {
  return observedHash === meta.confirmed_hash ? "tracked" : "version_pending";
}
