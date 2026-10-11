// 개발 도구 gallery의 page 목록 검사. 맞는 shell requirement가 없어 task 번호로 시작한다.
import { assert, assertEquals } from "@std/assert";

import { DISCARDED_NAME, DISCARDED_SCREENS, PAGES, PARTS } from "./pages.ts";

Deno.test("shell#T66: 버린 화면은 page 목록에 없다", () => {
  const screens = new Set(PAGES.map((page) => page.screen as string));
  for (const discarded of DISCARDED_SCREENS) {
    assert(!screens.has(discarded), `버린 화면: ${discarded}`);
  }
  // 지금 화면 part는 id·screen·title에도 버린 화면의 이름을 쓰지 않는다.
  for (const page of PAGES.filter((item) => item.part === "now")) {
    for (const text of [page.id, page.screen, page.title]) {
      assert(!DISCARDED_NAME.test(text), `버린 화면 이름: ${text}`);
    }
  }
});

Deno.test("shell#T66: 모든 page에 제목·badge·설명이 있고 id는 겹치지 않는다", () => {
  const partIds = PARTS.map((part) => part.id);
  const ids = new Set<string>();
  for (const page of PAGES) {
    assert(page.title.trim() !== "", `${page.id}: title`);
    assert(page.badges.length > 0, `${page.id}: badge`);
    assert(page.badges.every((badge) => badge.trim() !== ""), `${page.id}`);
    assert(page.description.trim() !== "", `${page.id}: description`);
    assert(partIds.includes(page.part), `${page.id}: part`);
    assert(/^[a-z0-9-]+$/.test(page.id), `${page.id}: id 모양`);
    assert(!ids.has(page.id), `${page.id}: id가 겹친다`);
    ids.add(page.id);
  }
  // 두 part 모두 page가 하나 이상 있다.
  for (const part of partIds) {
    assert(PAGES.some((page) => page.part === part), `${part}: page 없음`);
  }
});

Deno.test("shell#T66: 새 설계 page 아홉 개는 모두 새 설계 badge와 한국어 설명을 갖는다", () => {
  const fresh = PAGES.filter((page) => page.part === "new");
  assertEquals(fresh.length, 9);
  for (const page of fresh) {
    assertEquals(page.badges, ["새 설계"], page.id);
    assert(/[가-힣]/.test(page.description), `${page.id}: 한국어 설명`);
    assert(page.title.trim() !== "", `${page.id}: title`);
  }
});
