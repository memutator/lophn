import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";

// 목록·검색·이력·검사 진단의 이어 보기. 소유 contract의 cursor를 조건과 함께 감싼다.

// 이어 보기 위치. 조건이 다른 목록에서 온 cursor는 거절한다.

export function continuation(next: string | null): ToolResult["continuation"] {
  return next === null ? null : { has_more: true, read_next: next };
}

// 목록·검색·이력의 한 page. 앞 20개만 보이고, 소유 contract가 더 줬거나 상한에 걸려 덜어 낸
// 항목은 같은 page의 뒤 위치(skip)에서 이어 읽는다. 항목을 잃지 않는다.

// 목차·차이·용어처럼 소유 contract가 쪽을 정하는 읽기다. cursor만 조건과 함께 감싸고, 상한을 넘으면
// 지정한 배열 키의 뒤쪽 항목부터 덜어 낸다. `shape`가 있으면 소유 contract의 결과에서 보일 값만 고른다.
