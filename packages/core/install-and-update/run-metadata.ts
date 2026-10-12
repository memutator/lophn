import { err, ok, type Result } from "../../base/mod.ts";
import { RUN_METADATA_NAME } from "../../protocol/client/run-metadata.ts";
import { runMetadataSchema } from "../../protocol/supervision/mod.ts";

// H/run의 인증 없는 위치 metadata. port·epoch·시작 시각만 있고 credential은 없다.

export async function writeRunMetadata(
  runDir: string,
  metadata: { apiPort: number; coreEpoch: string; startedAt: string },
): Promise<Result<void>> {
  const parsed = runMetadataSchema.safeParse({
    format: 1,
    api_port: metadata.apiPort,
    core_epoch: metadata.coreEpoch,
    started_at: metadata.startedAt,
  });
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "위치 metadata가 올바르지 않다",
    });
  }
  const text = JSON.stringify(parsed.data);
  if (/"?(token|credential|secret)"?\s*:/i.test(text)) {
    return err({
      code: "internal",
      message: "위치 metadata에 credential 모양이 있다",
    });
  }
  const path = `${runDir}/${RUN_METADATA_NAME}`;
  const temporary = `${path}.tmp`;
  try {
    await Deno.writeTextFile(temporary, text, { mode: 0o600 });
    await Deno.rename(temporary, path);
  } catch {
    return err({
      code: "unavailable",
      message: "위치 metadata를 쓸 수 없다",
    });
  }
  return ok(undefined);
}

// 정상 종료에서만 지운다. 비정상 종료는 마지막 위치를 남겨 둔다.
export async function removeRunMetadata(runDir: string): Promise<void> {
  try {
    await Deno.remove(`${runDir}/${RUN_METADATA_NAME}`);
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) throw thrown;
  }
}
