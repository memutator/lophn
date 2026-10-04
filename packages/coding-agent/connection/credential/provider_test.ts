import { assert, assertEquals } from "@std/assert";
import {
  acceptConnectionRef,
  LOPHN_CONNECTION,
  reconnectionGuidance,
} from "./provider.ts";

function fail(result: ReturnType<typeof acceptConnectionRef>, message: string) {
  assert(!result.ok, message);
  return result.error;
}

Deno.test(
  "coding-agent/connection#R9: provider 입력은 connection 참조 하나다",
  () => {
    // 올바른 참조는 통과한다.
    const good = acceptConnectionRef("cac_01arz3ndektsv4rrffq69g5fav");
    assertEquals(good.ok && good.value, "cac_01arz3ndektsv4rrffq69g5fav");

    // 참조가 없으면 거절이다.
    assertEquals(
      fail(acceptConnectionRef(undefined), "absent").code,
      "invalid_input",
    );

    // 형태가 다른 참조도 거절이다.
    const broken = fail(acceptConnectionRef("conn-1"), "shape");
    assertEquals(broken.code, "invalid_input");

    // env 참조 이름은 contracts의 값 그대로다.
    assertEquals(LOPHN_CONNECTION, "LOPHN_CONNECTION");
  },
);

Deno.test(
  "coding-agent/connection#R9: 인증 실패 뒤 재연결 안내만 돌려준다",
  () => {
    const guidance = reconnectionGuidance(
      "cac_01arz3ndektsv4rrffq69g5fav",
    );

    // 안내는 회수·재연결 방식이고 새 token 발급·user credential 요청은 없다.
    assert(guidance.message.includes("회수"));
    assert(guidance.message.includes("새 연결"));
    const text = guidance.message + guidance.commands.join(" ");
    assert(!text.includes("재발급"));
    assert(!text.includes("LOPHN_TOKEN"));
    assert(!text.includes("password"));

    // 안내 명령은 기존 연결을 살펴보는 read다.
    assertEquals(
      guidance.commands,
      ["connection show cac_01arz3ndektsv4rrffq69g5fav"],
    );
  },
);
