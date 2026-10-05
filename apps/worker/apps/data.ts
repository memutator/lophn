// data worker job. supervisor가 운영 자식 종료 확인 뒤 작업별로 띄운다
// (architecture/apps 2.1). 한 앱 DB에 단독 접근하고 network·secret·외부 파일·
// subprocess 권한은 없다. kind와 root는 환경으로만 받고 credential은 받지 않는다.
import { decodeDataJobInput } from "../../../packages/contracts/apps/mod.ts";
import { runDataJob } from "../../../packages/apps/data/worker/job.ts";

export const DATA_WORKER_KIND = "apps/data";

// stdin JSON 한 줄 → stdout DataResult 한 줄. 실패는 stderr로만 나가고 stdout에는
// 성공 결과만 남긴다. 앱 데이터 영역은 root 안 apps/<app>/data다.
export async function runDataWorker(root: string): Promise<void> {
  const line = await readLine();
  let input;
  try {
    input = decodeDataJobInput(line);
  } catch {
    throw new Error("invalid data job input");
  }
  const dataArea = `${root}/apps/${input.app}/data`;
  // migration은 bundle의 고정 script와 invocation이 필요하므로 supervisor가
  // script를 확인해 runDataJob으로 직접 넘긴다. 이 진입은 backup·restore다.
  if (input.kind === "migrate") {
    throw new Error("migration needs its bundle scripts");
  }
  const outcome = await runDataJob(
    { dataArea, databasePath: `${dataArea}/data.db` },
    line,
  );
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
