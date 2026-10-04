// 개발·E2E용 실행. stdout 첫 줄은 기계가 읽는 ready 한 줄이다.
// 시나리오는 POST /__fake/script, 요청 log는 GET /__fake/log.
// 인증 header 값은 log에 넣지 않는다. 빈 script로 뜨고, 호출 0은 아직 실패가 아니다.
import { startFakeProvider } from "./mod.ts";

if (import.meta.main) {
  const provider = startFakeProvider({ script: { steps: [] } });
  console.log(JSON.stringify({ ready: true, url: provider.url }));
  const shutdown = () => {
    provider.close();
  };
  Deno.addSignalListener("SIGTERM", shutdown);
  Deno.addSignalListener("SIGINT", shutdown);
}
