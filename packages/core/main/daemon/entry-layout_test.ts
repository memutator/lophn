import assert from "node:assert/strict";
import { test } from "node:test";
import { installedLayout } from "./entry-layout.ts";

// 개발·test core가 사람의 OS에 시작 항목을 등록하면 안 된다. 저장소 layout은 OS port를 만들지 않는 쪽이다.
test("packages/shell이 있는 저장소 layout은 설치 layout이 아니다", () => {
  assert.equal(
    installedLayout("/repo", (p) => p === "/repo/packages/shell"),
    false,
  );
  assert.equal(
    installedLayout("/opt/lophn/resources/platform", () => false),
    true,
  );
});
