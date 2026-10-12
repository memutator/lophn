// 옛 질문 칸이 없어졌음을 지킨다. 질문은 대화 안 카드(shell/desktop#R46)가 맡는다.
import { assert, assertEquals } from "@std/assert";

Deno.test("shell/desktop#R46 [I45]: conversation/question-strip 폴더가 없다", async () => {
  let found = true;
  try {
    await Deno.stat(new URL("./question-strip/", import.meta.url));
  } catch (error) {
    assert(error instanceof Deno.errors.NotFound);
    found = false;
  }
  assertEquals(found, false);
});
