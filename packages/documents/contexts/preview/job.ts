// context.preview 일: draft의 계약이 가리키는 폴더를 임시 snapshot으로 복사해 고정하고, 그 snapshot에서만
// previewDraft를 돌린다. index·ledger는 쓰지 않고 낼 command도 없다(docs/architecture/documents.md 2.4).
// 순서는 snapshot 만들기 → previewDraft → snapshot 지우기이며, 어느 길로 끝나도 snapshot은 지운다.
// snapshot을 만들지 못하면(파일 수·바이트 예산 초과, 읽을 수 없음) `unavailable`이고 부분 결과는 없다.
import { ok, type Result } from "../../../base/mod.ts";
import { bundleContentSchema } from "../../../contracts/documents/mod.ts";
import { watchFolders } from "../watch/mod.ts";
import type { SnapshotPort } from "../work-types.ts";
import { previewDraft } from "./run.ts";
import type { PreviewInput, PreviewOutcome } from "./types.ts";

export type PreviewJobRequest = {
  // 임시 snapshot 폴더 이름. 호출마다 다르다.
  snapshot: string;
  draft: unknown;
  env: PreviewInput["env"];
  // Project 폴더의 절대 경로. `snapshots`가 이것으로 파일을 복사한다. 어댑터가 따로 알면 비워도 된다.
  roots?: readonly string[];
};

export async function runPreviewJob(
  deps: { snapshots: SnapshotPort },
  request: PreviewJobRequest,
): Promise<Result<PreviewOutcome>> {
  const parsed = bundleContentSchema.safeParse(request.draft);
  const folders = parsed.success ? watchFolders(parsed.data.contract) : [];
  const snapshot = deps.snapshots.create(
    request.snapshot,
    folders,
    request.roots,
  );
  if (!snapshot.ok) return snapshot;
  try {
    return ok(previewDraft({
      draft: request.draft,
      files: snapshot.value.files,
      appData: () => undefined,
      env: request.env,
    }));
  } finally {
    snapshot.value.remove();
  }
}
