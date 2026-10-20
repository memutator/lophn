import { assertNotEquals } from "@std/assert";
import { clientFor } from "./runner-service.ts";

// 코딩 session마다 request_principal이 다르지만 request_key는 "t-1"처럼 겹친다. runner의 command key가
// request_key만으로 정해지면 ledger가 다른 요청의 재전달로 보고 conflict를 내서 요청이 영영 시작하지 않는다.
Deno.test("runner command keys differ for the same request_key of different principals", async () => {
  const seen: string[] = [];
  const fetcher = (_url: string, init: { body: string }) => {
    seen.push(JSON.parse(init.body).idempotency_key);
    return Promise.resolve({
      status: 200,
      bytes: new TextEncoder().encode("{}"),
    });
  };
  const job = (request_principal: string) => ({
    request_principal,
    request_key: "t-1",
    request_hash: "h",
    app: "app_x",
    connection: {} as never,
    credential: "c",
    api_port: 1,
  });
  for (const principal of ["coding_agent:ses_a", "coding_agent:ses_b"]) {
    const client = await clientFor(job(principal), fetcher);
    await client.command("observe-test-request", {}, "start_attempt");
  }
  assertNotEquals(seen[0], seen[1]);
});
