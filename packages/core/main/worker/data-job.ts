// data worker job 한 번의 진입이다. supervisor가 작업마다 권한을 좁혀 띄우고 argv로 data root를 받는다.
// stdin JSON 한 줄을 읽어 stdout에 결과 한 줄을 낸다(`runDataWorker`). credential은 받지 않는다.
import { runDataWorker } from "../../apps/data/worker/run.ts";

if (import.meta.main) {
  const root = Deno.args[0];
  if (root === undefined || Deno.args.length !== 1) {
    throw new Error("invalid data job arguments");
  }
  await runDataWorker(root);
}
