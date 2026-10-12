import { err, ok, type Result } from "../../base/mod.ts";
import {
  type RunMetadata,
  runMetadataSchema,
} from "../../protocol/server/mod.ts";

// H/run의 인증 없는 위치 metadata. port·epoch·시작 시각만 있고 credential은 없다.
const NAME = "location.json";

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
  const path = `${runDir}/${NAME}`;
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
    await Deno.remove(`${runDir}/location.json`);
  } catch (thrown) {
    if (!(thrown instanceof Deno.errors.NotFound)) throw thrown;
  }
}

// H/run의 위치 metadata를 읽는다(cli#R8의 daemon status가 쓴다). 파일 이름은
// 고정 상수이고 내용은 schema로 걸러 credential 모양은 애초에 없다. 값 자체를
// log에 그대로 쓰지 않는 것은 호출자의 몫이다.
export async function readRunMetadata(
  runDir: string,
): Promise<Result<RunMetadata>> {
  let text: string;
  try {
    text = await Deno.readTextFile(`${runDir}/${NAME}`);
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) {
      return err({ code: "not_found", message: "실행 중인 instance가 없다" });
    }
    return err({
      code: "unavailable",
      message: "위치 metadata를 읽을 수 없다",
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err({ code: "not_found", message: "위치 metadata가 올바르지 않다" });
  }
  const parsed = runMetadataSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "not_found", message: "위치 metadata가 올바르지 않다" });
  }
  return ok(parsed.data);
}
