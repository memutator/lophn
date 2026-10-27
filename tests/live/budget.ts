// 진짜 provider 호출을 감싼다: 호출 수를 세어 상한을 넘으면 보내지 않고 실패하고,
// 기록 option이 켜져 있으면 받은 응답만(요청은 아님) fixture 꼴로 쓴다.

import { mkdirSync, writeFileSync } from "node:fs";

export const CALL_LIMIT = 10;
export const CALL_TIMEOUT_MS = 90_000;

export const FIXTURE_ROOT = new URL("../fixtures/provider/", import.meta.url);

// 계정을 가리키는 값을 지운다. key 자체와 request·organization id가 대상이다.
export function scrub(text: string, key: string): string {
  return text
    .replaceAll(key, "REDACTED")
    .replace(
      /"(request_id|organization|organization_id|org_id)"\s*:\s*"[^"]*"/g,
      '"$1":"REDACTED"',
    )
    .replace(/\b(req_|org-|sk-ant-|sk-)[A-Za-z0-9_-]+/g, "REDACTED");
}

// 호출 수는 이 budget 하나가 센다(test file 하나에 하나).
export function createBudget(options: { record: URL | null }) {
  let calls = 0;
  return {
    // case 하나가 쓸 fetch. case 이름은 `live-<행>`이다.
    fetchFor(provider: string, row: string, key: string): typeof fetch {
      return async (input, init) => {
        if (++calls > CALL_LIMIT) {
          throw new Error(`live call limit ${CALL_LIMIT} exceeded`);
        }
        const response = await fetch(input, init);
        if (options.record === null) return response;
        const body = scrub(await response.text(), key);
        const type = response.headers.get("content-type") ?? "";
        const dir = new URL(`${provider}/`, options.record);
        mkdirSync(dir, { recursive: true });
        const name = `live-${row}`;
        const ext = type.includes("text/event-stream") ? "sse" : "json";
        writeFileSync(new URL(`${name}.${ext}`, dir), body);
        writeFileSync(
          new URL(`${name}.meta.json`, dir),
          JSON.stringify(
            { status: response.status, headers: { "content-type": type } },
            null,
            2,
          ) + "\n",
        );
        return new Response(body, {
          status: response.status,
          headers: response.headers,
        });
      };
    },
  };
}
