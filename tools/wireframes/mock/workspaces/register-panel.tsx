// 프로젝트 등록 dialog. 화면은 renderer의 RegisterDialog가 그리고 여기서는 fake source에 이어 준다. 이름, 목적, 폴더와
// 폴더 설명이고 짧은 이름 고르기는 없다. Home의 Workspaces panel과 left sidebar의 + 단추가 같이 쓴다. 폴더 하나를 더하고 칸을 채운 상태로 고정한다.

import { click, type } from "../drive.ts";

/** 열린 등록 dialog를 채우는 동작. Home page도 같이 쓴다. */
export function registerSteps() {
  return [
    () => type('[data-field="name"]', "trip-planner"),
    () =>
      type(
        '[data-field="purpose"]',
        "Plan the autumn trip and keep the bookings in one place.",
      ),
    () => click("[data-add-folder]"),
    () => type("[data-folder-description]", "Bookings and itineraries"),
  ];
}
