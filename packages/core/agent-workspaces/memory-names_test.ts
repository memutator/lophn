import assert from "node:assert/strict";
import { test } from "node:test";
import { err } from "../../base/mod.ts";
import { memoryNames } from "./memory-names.ts";

const GONE = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const UNREAD = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";

// "deleted"를 보면 agent가 그 note를 지운다. 읽지 못한 것을 지운 것으로 알리면 사람이 정한 note를 잃는다.
test("memory의 id는 없는 것만 deleted로 풀고, 읽지 못한 id는 줄을 내지 않는다", async () => {
  const names = await memoryNames(
    async (_path, body) =>
      (body as { app: string }).app === GONE
        ? err({ code: "not_found", message: "app not found" })
        : err({ code: "unavailable", message: "core is busy" }),
    [`- Mahas (${GONE}): leave as is\n- Calendar (${UNREAD}): update`],
  );
  assert.equal(names, `- ${GONE}: deleted app`);
});
