// data worker job. supervisor가 운영 자식 종료 확인 뒤 작업별로 띄운다.
// 한 앱 DB(`<data 영역>/app.sqlite`)에 단독 접근한다. migration 자식만
// network·secret·외부 파일·subprocess 권한이 없다. kind와 root는 환경으로만 받고 credential은 받지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { decodeActivationDataJobInput } from "../../../../protocol/apps/mod.ts";
import { runDataJob } from "./job.ts";
import { type MigrationScript, scriptFromBundle } from "./migrate.ts";

export const DATA_WORKER_KIND = "apps/data";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// job 한 줄을 root 아래 그 앱의 데이터 영역에서 돌린다. migrate는 bundle 사본의 단계 파일
// (`migrations/<from>-<to>.sql`)을 release의 data_changes와 hash로 맞춰 읽는다. bundle은 그 앱의 사본이어야 한다.
export async function runDataJobLine(
  root: string,
  line: string,
): Promise<Result<string>> {
  let input;
  try {
    input = decodeActivationDataJobInput(line);
  } catch {
    return invalid("invalid data job input");
  }
  const dataArea = `${root}/apps/${input.app}/data`;
  const context = { dataArea, databasePath: `${dataArea}/app.sqlite` };
  // 첫 activation 전의 앱은 데이터 영역이 아직 없다. 이 작업이 그 영역(과 앱 폴더)만 만든다.
  try {
    await Deno.mkdir(dataArea, { recursive: true });
  } catch {
    return err({
      code: "unavailable",
      message: "app data area cannot be made",
    });
  }
  if (input.kind !== "migrate") {
    const outcome = await runDataJob(context, line);
    return outcome.ok ? outcome : err(outcome.error);
  }
  const bundles = `${root}/apps/${input.app}/bundles/`;
  if (
    input.bundle_path === undefined || !input.bundle_path.startsWith(bundles) ||
    input.bundle_path.slice(bundles.length).includes("/") ||
    input.data_changes === undefined || input.invocation === undefined
  ) {
    return invalid("migration needs its own bundle and data changes");
  }
  const scripts: MigrationScript[] = [];
  for (const change of input.data_changes) {
    const loaded = await scriptFromBundle(input.bundle_path, change);
    if (!loaded.ok) return loaded;
    scripts.push(loaded.value);
  }
  const outcome = await runDataJob({
    ...context,
    scripts,
    appliedAt: new Date().toISOString(),
    invocation: input.invocation,
  }, line);
  return outcome.ok ? ok(outcome.value) : err(outcome.error);
}

// stdin JSON 한 줄 → stdout 결과 한 줄. 실패는 stderr로만 나가고 stdout에는 성공 결과만 남긴다.
export async function runDataWorker(root: string): Promise<void> {
  const outcome = await runDataJobLine(root, await readLine());
  if (!outcome.ok) throw new Error(outcome.error.message);
  await Deno.stdout.write(new TextEncoder().encode(outcome.value));
}

async function readLine(): Promise<string> {
  const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream())
    .getReader();
  let line = "";
  while (!line.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    line += chunk.value;
  }
  reader.releaseLock();
  return line;
}
