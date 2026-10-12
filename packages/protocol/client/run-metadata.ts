import { err, ok, type Result } from "../../base/mod.ts";
import {
  type RunMetadata,
  runMetadataSchema,
} from "../supervision/supervision.ts";

// H/run의 인증 없는 위치 metadata 파일 이름. 쓰는 쪽(core)과 읽는 쪽(client)이 같이 쓴다.
export const RUN_METADATA_NAME = "location.json";

// H/run의 위치 metadata를 읽는다(daemon status가 쓴다). 파일 이름은
// 고정 상수이고 내용은 schema로 걸러 credential 모양은 애초에 없다. 값 자체를
// log에 그대로 쓰지 않는 것은 호출자의 몫이다.
export async function readRunMetadata(
  runDir: string,
): Promise<Result<RunMetadata>> {
  let text: string;
  try {
    text = await Deno.readTextFile(`${runDir}/${RUN_METADATA_NAME}`);
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
