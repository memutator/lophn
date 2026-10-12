// 앱 export 준비 프로세스 입구(apps/data#R13). core의 export serving이 ledger 읽기와 앱 접근
// 판정을 끝낸 뒤에만 띄운다. 앱 DB를 여는 일(backup·무결성 확인)과 export 묶음 쓰기는
// core graph 밖인 이 프로세스의 몫이다(responsiveness#R1). 입력은 stdin JSON 한 개, 결과는
// stdout 마지막 줄 JSON 하나다. 읽기·쓰기는 LOPHN_HOME(데이터 root) 안에만 허용된다.
import { prepareAppExport } from "../../apps/data/worker/export.ts";
import type { ExportJob } from "../../apps/data/reads.ts";

function reply(message: unknown): never {
  Deno.stdout.writeSync(
    new TextEncoder().encode(`\n${JSON.stringify(message)}\n`),
  );
  Deno.exit(0);
}

async function readAll(): Promise<string> {
  let text = "";
  for await (
    const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())
  ) text += chunk;
  return text;
}

async function runExport(
  root: string,
  raw: string,
): Promise<{ ok: boolean; message?: string }> {
  let job: ExportJob;
  try {
    job = JSON.parse(raw) as ExportJob;
  } catch {
    return { ok: false, message: "export job is not valid" };
  }
  if (typeof job.app !== "string" || job.sdkRoot !== `${root}/sdk`) {
    return { ok: false, message: "export job is not valid" };
  }
  const prepared = await prepareAppExport(
    root,
    `${root}/apps/${job.app}/data/app.sqlite`,
    {
      app: job.app,
      ...(job.blueprintJson === undefined
        ? {}
        : { blueprintJson: new TextEncoder().encode(job.blueprintJson) }),
      releases: job.releases,
      bundles: job.bundles,
      sdkRoot: job.sdkRoot,
    },
  );
  return prepared.ok ? { ok: true } : {
    ok: false,
    message: prepared.error.message,
  };
}

if (import.meta.main) {
  const root = Deno.env.get("LOPHN_HOME");
  if (root === undefined) reply({ ok: false, message: "data root is missing" });
  reply(await runExport(root, await readAll()));
}
