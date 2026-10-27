// data worker job. supervisor가 운영 자식 종료 확인 뒤 작업별로 띄운다.
// 한 앱 DB(`<data 영역>/app.sqlite`)에 단독 접근한다. kind와 root는 환경으로만 받고
// credential은 받지 않는다.
import { mkdir } from "node:fs/promises";
import process from "node:process";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  appDataFolder,
  appFolder,
  decodeActivationDataJobInput,
} from "../../../../protocol/apps/mod.ts";
import { runDataJob } from "./job.ts";
import { type MigrationScript, scriptFromBundle } from "./migrate.ts";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// job 한 줄을 root 아래 그 앱의 데이터 영역(`apps/<app>/data`)에서 돌린다. migrate는 bundle 사본의 단계 파일
// (`migrations/<from>-<to>.sql`)을 release의 data_changes와 hash로 맞춰 읽는다. bundle은 그 앱의 사본이어야 한다.
async function runDataJobLine(
  root: string,
  line: string,
): Promise<Result<string>> {
  let input;
  try {
    input = decodeActivationDataJobInput(line);
  } catch {
    return invalid("invalid data job input");
  }
  const dataArea = appDataFolder(root, input.app);
  const context = { dataArea, databasePath: `${dataArea}/app.sqlite` };
  // 첫 activation 전의 앱은 데이터 영역이 아직 없다. 이 작업이 그 영역(과 앱 폴더)만 만든다.
  try {
    await mkdir(dataArea, { recursive: true });
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
  const bundles = `${appFolder(root, input.app)}/bundles/`;
  if (
    input.bundle_path === undefined ||
    !input.bundle_path.startsWith(bundles) ||
    input.bundle_path.slice(bundles.length).includes("/") ||
    input.data_changes === undefined ||
    input.invocation === undefined
  ) {
    return invalid("migration needs its own bundle and data changes");
  }
  const scripts: MigrationScript[] = [];
  for (const change of input.data_changes) {
    const loaded = await scriptFromBundle(input.bundle_path, change);
    if (!loaded.ok) return loaded;
    scripts.push(loaded.value);
  }
  const outcome = await runDataJob(
    {
      ...context,
      scripts,
      appliedAt: new Date().toISOString(),
      invocation: input.invocation,
    },
    line,
  );
  return outcome.ok ? ok(outcome.value) : err(outcome.error);
}

// stdin JSON 한 줄 → stdout 결과 한 줄. 실패는 stderr로만 나가고 stdout에는 성공 결과만 남긴다.
export async function runDataWorker(root: string): Promise<void> {
  const outcome = await runDataJobLine(root, await readLine());
  if (!outcome.ok) throw new Error(outcome.error.message);
  await process.stdout.write(outcome.value);
}

async function readLine(): Promise<string> {
  // chunk 경계가 멀티바이트 문자를 가를 수 있어 stream 모드로 이어 붙인다.
  const decoder = new TextDecoder();
  let line = "";
  for await (const chunk of process.stdin) {
    line += decoder.decode(chunk, { stream: true });
    if (line.includes("\n")) break;
  }
  return line;
}
