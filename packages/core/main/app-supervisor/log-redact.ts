// 앱 log 줄의 redaction 조립. packages/core/apps/runtime/observations/log-file.ts의 앱 log file writer는 줄 redaction을
// 주입받고, 알려진 secret registry와 credential pattern은 platform/redaction이 준다.
import {
  createRedactionStream,
  type KnownSecretRegistry,
} from "../../../base/redaction/mod.ts";

export function lineRedactor(
  registry: KnownSecretRegistry,
): (line: string) => string {
  // 줄마다 새 stream을 쓴다. 보류 꼬리가 다음 줄로 새지 않는다.
  return (line) => {
    const stream = createRedactionStream(registry);
    return stream.push(line) + stream.finish();
  };
}
