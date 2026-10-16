// test 자식(harness)과 runner 사이의 private 호출 통로다. 자식은 scratch 폴더(`rpc/`)에 요청 파일을
// 쓰고 runner가 응답 파일을 쓴다. 자식에는 net·run 권한이 없으므로 이 폴더가 둘이 주고받는 유일한
// 길이다. runner가 실제 앱 자식과 broker를 쥐고 AppDriver를 구현하고, 자식은 이 통로로만 만진다
// (앱 code는 격리 자식, harness는 따로 도는 test 자식이다).
import type { AppDriver } from "./driver.ts";

const RPC_DIR = "rpc";
const POLL_MS = 15;
// 자식이 부를 수 있는 AppDriver 방법. runner 쪽 driver의 그 밖의 방법은 자식에 닿지 않는다.
const METHODS = ["probe", "rejectsInvalidInput", "rewind", "migrate"];

type Request = { n: number; method: string; args: unknown[] };
type Response =
  | { n: number; ok: true; value: unknown }
  | { n: number; ok: false; error: string };

async function writeAtomic(path: string, text: string): Promise<void> {
  await Deno.writeTextFile(`${path}.tmp`, text);
  await Deno.rename(`${path}.tmp`, path);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// test 자식 쪽. 호출마다 요청 파일 하나를 쓰고 응답 파일이 나올 때까지 기다린다. 기한은 runner의
// process timeout이 강제한다.

// runner 쪽. 자식이 도는 동안 요청 폴더를 읽어 순서대로 실행하고 응답을 쓴다. 정지하면 마지막
// 요청까지 마치고 끝난다.
export function serveRpc(
  scratch: string,
  driver: AppDriver,
): { stop(): Promise<void> } {
  const dir = `${scratch}/${RPC_DIR}`;
  let stopping = false;
  const done = new Set<number>();
  const dispatch = async (request: Request): Promise<unknown> => {
    if (!METHODS.includes(request.method)) throw new Error("unknown method");
    const method = (driver as unknown as Record<string, unknown>)[
      request.method
    ];
    if (typeof method !== "function") throw new Error("unknown method");
    return await (method as (...args: unknown[]) => Promise<unknown>)
      .apply(driver, request.args);
  };
  const loop = (async () => {
    await Deno.mkdir(dir, { recursive: true });
    while (!stopping) {
      let next: Request | undefined;
      try {
        for await (const entry of Deno.readDir(dir)) {
          const match = /^(\d+)\.req\.json$/.exec(entry.name);
          if (!match || done.has(Number(match[1]))) continue;
          const text = await Deno.readTextFile(`${dir}/${entry.name}`);
          const request = JSON.parse(text) as Request;
          if (!next || request.n < next.n) next = request;
        }
      } catch { /* 폴더가 아직 비었거나 요청 파일이 쓰이는 중이다 */ }
      if (!next) {
        await sleep(POLL_MS);
        continue;
      }
      done.add(next.n);
      let response: Response;
      try {
        response = { n: next.n, ok: true, value: await dispatch(next) };
      } catch (error) {
        response = {
          n: next.n,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await writeAtomic(`${dir}/${next.n}.res.json`, JSON.stringify(response));
    }
  })();
  return {
    async stop() {
      stopping = true;
      await loop;
    },
  };
}
