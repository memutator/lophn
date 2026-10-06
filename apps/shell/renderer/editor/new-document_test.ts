// 판이 아직 없는 새 문서의 편집(shell#T17, flow write-series 2·5). 입력 멈춤에는 아무것도 보내지
// 않고 편집 종료만 첫 판을 만들며, draft 보존과 판 확정을 다른 상태로 둔다.
import { assert, assertEquals } from "@std/assert";

import type { CreateReport, EditorReply } from "../../ipc/editor.ts";
import { NewDocumentSession } from "./new-document.ts";

const V1 = "ver_01kq12a1pha000000000000001";

function harness(
  answers: EditorReply<CreateReport>[],
  lookup: string | null | undefined = null,
) {
  const sent: string[] = [];
  let looked = 0;
  const session = new NewDocumentSession({
    text: "# P003\n\n",
    now: () => 1000,
    newKey: () => `key-${sent.length + 1}`,
    port: {
      create(input) {
        sent.push(new TextDecoder().decode(input.bytes));
        return Promise.resolve(answers.shift()!);
      },
      lookup() {
        looked += 1;
        return Promise.resolve(lookup);
      },
    },
  });
  return { session, sent, looked: () => looked };
}

const saved: EditorReply<CreateReport> = {
  ok: true,
  value: { outcome: "saved", version: V1, failure: null },
};

Deno.test("shell/editor#R1 shell/editor#R2: 새 문서는 입력 멈춤에 보내지 않고 편집 종료에서 한 번 첫 판을 만든다", async () => {
  const { session, sent } = harness([saved]);
  // 고친 글이 없으면 편집 종료도 판을 만들지 않는다(가족 draft만 남는다).
  assert(await session.flush(true));
  assertEquals(sent, []);
  assertEquals(session.needsEnd(), false);

  session.edit("# P003\n\nthird\n");
  assertEquals(session.facts.state, "draft");
  assertEquals(session.needsEnd(), true);
  assert(await session.flush(false));
  assertEquals(sent, []);

  assert(await session.flush(true));
  assertEquals(sent, ["# P003\n\nthird\n"]);
  assertEquals(session.facts, {
    state: "saved",
    edited: true,
    version: V1,
    at: 1000,
  });
  assertEquals(session.needsEnd(), false);
  assertEquals(session.unsettled(), false);
  // 첫 판 뒤에는 다시 만들지 않는다.
  session.edit("# P003\n\nmore\n");
  assert(await session.flush(true));
  assertEquals(sent.length, 1);
});

Deno.test("shell/editor#R2 shell/editor#R12: 저장하지 못하면 글을 그대로 두고 실패를 보이며 사람의 다시 시도로만 다시 보낸다", async () => {
  const { session, sent } = harness([
    { ok: true, value: { outcome: "failed", version: null, failure: "unavailable" } },
    saved,
  ]);
  session.edit("# P003\n\nthird\n");
  assertEquals(await session.flush(true), false);
  assertEquals(session.facts.state, "failed");
  assertEquals(session.unsettled(), true);
  assertEquals(session.text, "# P003\n\nthird\n");
  session.retry();
  assert(await session.flush(false));
  assertEquals(session.facts.state, "saved");
  assertEquals(sent.length, 2);
});

Deno.test("shell/editor#R2 documents/series#R2: 그 사이 key·가족이 바뀐 저장은 충돌로 멈추고 다시 보내지 않는다", async () => {
  const { session, sent } = harness([
    { ok: true, value: { outcome: "conflict", version: null, failure: null } },
  ]);
  session.edit("# P003\n\nthird\n");
  assertEquals(await session.flush(true), false);
  assertEquals(session.facts.state, "conflict");
  assertEquals(await session.flush(true), false);
  assertEquals(sent.length, 1);
  // 명시 폐기 뒤에는 남은 저장이 없다.
  session.discard();
  assertEquals(session.unsettled(), false);
  assertEquals(session.needsEnd(), false);
});

Deno.test("shell/editor#R2: 통로가 끊겨 결과를 모르면 다시 저장하지 않고 그 예정 문서를 조회한다", async () => {
  const found = harness([{ ok: false, code: "unavailable" }], V1);
  found.session.edit("# P003\n\nthird\n");
  await found.session.flush(true);
  // 조회는 곧바로 한 번 한다. 문서가 있으면 첫 판이 생긴 것이다.
  await found.session.check();
  assertEquals(found.session.facts.state, "saved");
  assertEquals(found.session.facts.version, V1);
  assertEquals(found.sent.length, 1);

  const absent = harness([{ ok: false, code: "unavailable" }], null);
  absent.session.edit("# P003\n\nthird\n");
  await absent.session.flush(true);
  await absent.session.check();
  // 아직 없으면 저장되지 않은 draft로 돌아가 다음 편집 종료가 다시 만든다.
  assertEquals(absent.session.facts.state, "draft");
  assertEquals(absent.session.needsEnd(), true);
  assertEquals(absent.sent.length, 1);
  assert(absent.looked() >= 1);
});
