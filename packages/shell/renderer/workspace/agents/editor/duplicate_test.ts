import assert from "node:assert/strict";
import { test } from "node:test";

import { copyDefinition, copyHandle } from "./duplicate.ts";

// 겹치는 handle로 만들면 core가 거절한다. 복제는 겹치지 않는 handle을 먼저 지어야 사람이 고치지 않고 만든다.
test("복제 handle은 쓰인 handle과 겹치지 않고 40자를 넘지 않는다", () => {
  assert.equal(copyHandle("eval", ["lophn"]), "eval-copy");
  assert.equal(copyHandle("Eval", ["eval-copy", "EVAL-COPY-2"]), "eval-copy-3");
  const long = copyHandle("a".repeat(40), []);
  assert.equal(long.length, 40);
  assert.ok(long.endsWith("-copy"));
});

// 다른 agent의 secret 이름을 가리키는 server가 생기면 두 agent가 한 credential을 나눠 쓴다.
test("복제는 이미지 avatar를 빼고 agent 층 server의 secret 이름을 새 id로 바꾼다", () => {
  const { definition, imageDropped } = copyDefinition(
    {
      id: "agt_old",
      scope: null,
      runtime: undefined,
      definition: {
        handle: "notes",
        name: "Notes",
        profile: { kind: "image", image: "avatar.png" },
        body: "Read notes.",
        mcp_servers: [
          {
            name: "docs",
            enabled: true,
            call_timeout_ms: 60_000,
            transport: "http",
            http: {
              url: "https://docs.example.com/mcp",
              headers: {},
              auth: {
                kind: "bearer",
                credential: { secret: "mcp.agt_old.docs" },
              },
            },
          },
        ],
      },
    },
    { name: "Notes copy", handle: "notes-copy", id: "agt_new" },
  );
  assert.equal(imageDropped, true);
  assert.equal(definition.profile, undefined);
  assert.equal(definition.body, "Read notes.");
  assert.match(JSON.stringify(definition.mcp_servers), /mcp\.agt_new\.docs/);
  assert.doesNotMatch(JSON.stringify(definition.mcp_servers), /agt_old/);
});
