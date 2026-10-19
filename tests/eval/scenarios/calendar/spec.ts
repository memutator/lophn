// 캘린더 단위 시나리오 넷이 같이 쓰는 이름, 요구 카드, tool 호출 script. 시나리오가 아니라 runner가 읽지 않는다.
// 값은 tests/eval/materials의 notify-app, date-range, calendar-call, calendar-app, calendar-app-bug, calendar-data에서 옮겼다.
// 이 file은 calendar 폴더 시나리오의 hash에 든다: 값을 고치면 시나리오 n을 올린다.
import type {
  ApiStep,
  BugSpec,
  ObserveSpec,
  ReuseSpec,
} from "../../checks/app/mod.ts";
import CALL_MVP_JSON from "../../materials/calendar-call/3/files/call.json" with {
  type: "json",
};

// deliver하는 call. 요청 본문은 judge 입력에도 쓴다.
export const CALL_MVP: { body: string } = CALL_MVP_JSON;

export const APP = "캘린더";
export const NOTIFY_APP = "알림";
export const OPERATOR = "일정관리";

// 복원된 calendar-app@2의 첫 release 번호. releaseAdvanced가 이보다 큰 active release를 기대한다.
export const RESTORED_RELEASE = 1;

export const PKG = "@me/date-range";
// date-range@2의 publish.json exports에 정의 검사용 type 이름을 더했다.
export const PKG_EXPORTS = ["toDate", "formatLocal", "weekRange", "DateParts"];

// ---- 요구 카드 ----

export const CARD_MVP = `원하는 것: 일정 추가·목록·삭제, 일정 전 알림
정해 둔 답: 알림은 일정 시작 10분 전. 한 주는 월요일부터 일요일까지. 목록은 이번 주·다음 주·전체로 거름. 반복은 지금 필요 없음
모르는 것: 색, 화면 배치 → "추천대로 해 줘"`;

export const CARD_MAINTAIN =
  `원하는 것: 반복 일정. event.add에 repeat 입력("none" 또는 "weekly", 주지 않으면 "none")을 더한다
정해 둔 답: 반복은 매주(weekly)만. weekly이면 start부터 매주 같은 요일·같은 시각으로 모두 4번 나타난다. 지금 있는 일정과 tool 이름·입력, 알림은 시작 10분 전, 한 주는 월요일~일요일 그대로
모르는 것: 그 밖의 전부 → "추천대로 해 줘"`;

// 사람 역할이 없는 단위지만 카드를 둔다: App Engineer가 ask하면 답할 사람이 없어 상한까지 멈춘다.
export const CARD_DIAGNOSE =
  `원하는 것: 이 문제가 다시 나지 않게 고쳐 줘. 이미 쓰는 tool의 이름과 입력은 바꾸지 마
모르는 것: 그 밖의 전부 → "추천대로 해 줘"`;

// ---- 사람 말 ----

export const SAY_MAINTAIN =
  `캘린더 앱에 반복 일정 기능을 더해 줘. event.add 입력에 repeat("none" 또는 "weekly")를 더해 줘. 주지 않으면 "none"이고 지금처럼 일정 하나만 만들어. "weekly"이면 start부터 매주 같은 요일·같은 시각으로 일정이 나타나게 해 줘. event.list에도 나와야 해.`;

export const SAY_API =
  "다음 주 화요일 3시에 치과 일정 넣고 이번 주 일정 알려 줘";

// ---- tool 호출 script ----

type Start = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export const D = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Start => ({ year, month, day, hour, minute });

type Row = { title?: unknown; start?: unknown };
const rowsOf = (
  result: unknown,
): Row[] => ((result as { rows?: Row[] } | null)?.rows ?? []);

// 줄 수와 순서에 기대지 않고 필요한 일정이 있는지만 본다.
const hasEvent = (title: string, start: string) => (result: unknown) =>
  rowsOf(result).some((r) => r.title === title && r.start === start)
    ? null
    : `${title} ${start} 일정이 없음`;

const firstId = (prev: unknown[]) => ({ id: (prev[0] as { id: number }).id });

// 빈 DB에서 도는 앱(calendar-mvp).
export const MVP_SCRIPT: ApiStep[] = [
  {
    api: "event.add",
    input: { title: "치과", start: D(2099, 3, 10, 15, 0) },
    expect: { title: "치과", start: "2099-03-10T15:00" },
  },
  {
    api: "event.list",
    input: { range: "all" },
    expect: { rows: [{ title: "치과", start: "2099-03-10T15:00" }] },
  },
  { api: "event.list", input: { range: "this_week" }, expect: { rows: [] } },
  { api: "event.remove", input: firstId, expect: { removed: true } },
  { api: "event.remove", input: firstId, expect: { removed: false } },
  { api: "event.list", input: { range: "all" }, expect: { rows: [] } },
];

// 일정 data가 이미 있는 앱(calendar-maintain).
export const OLD_SCRIPT: ApiStep[] = [
  {
    api: "event.add",
    input: { title: "치과", start: D(2099, 4, 7, 15, 0) },
    expect: { title: "치과", start: "2099-04-07T15:00" },
  },
  {
    api: "event.list",
    input: { range: "all" },
    expect: hasEvent("치과", "2099-04-07T15:00"),
  },
  { api: "event.remove", input: firstId, expect: { removed: true } },
];

// calendar-data@2의 일정 셋이 start 빠른 순으로 들어 있다.
const SEED = [
  { title: "팀 회의", start: "2099-03-02T10:00" },
  { title: "점심 약속", start: "2099-03-04T12:00" },
  { title: "독서 모임", start: "2099-03-06T19:00" },
];
export const SEED_CALLS: ApiStep[] = [{
  api: "event.list",
  input: { range: "all" },
  expect: (result: unknown) => {
    const rows = rowsOf(result);
    const at = SEED.map((s) =>
      rows.findIndex((r) => r.title === s.title && r.start === s.start)
    );
    return at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]!))
      ? null
      : "seed 일정 셋이 start 빠른 순으로 있지 않음";
  },
}];

const REPEAT_STARTS = [
  "2099-05-04T07:00",
  "2099-05-11T07:00",
  "2099-05-18T07:00",
  "2099-05-25T07:00",
];
export const REPEAT_SCRIPT: ApiStep[] = [
  {
    api: "event.add",
    input: { title: "운동", start: D(2099, 5, 4, 7, 0), repeat: "weekly" },
    expect: { title: "운동", start: "2099-05-04T07:00" },
  },
  {
    api: "event.list",
    input: { range: "all" },
    expect: (result: unknown) => {
      const starts = rowsOf(result).filter((r) => r.title === "운동")
        .map((r) => r.start);
      const missing = REPEAT_STARTS.filter((s) => !starts.includes(s));
      return missing.length === 0
        ? null
        : `운동 일정에 ${missing.join(", ")}이 없음`;
    },
  },
];

// ---- check 명세 ----

export const REUSE: ReuseSpec = {
  app: APP,
  notify: { app: NOTIFY_APP, api: "notify.schedule" },
  pkg: { name: PKG, exports: PKG_EXPORTS },
};

// 기준 앱에서 badInput은 event_input_invalid, notifyDown은 notify_call_failed, store는 store_unavailable을 연다.
export const OBSERVE: ObserveSpec = {
  app: APP,
  notify: NOTIFY_APP,
  badInput: {
    api: "event.add",
    input: { title: "잘못된 입력", start: D(2099, 2, 30, 9, 0) },
  },
  notifyDown: {
    api: "event.add",
    input: { title: "알림 실패", start: D(2099, 6, 1, 9, 0) },
  },
  store: { api: "event.list", input: { range: "all" } },
};

// calendar-app-bug@2의 bug.json.
export const BUG: BugSpec = {
  api: "event.list",
  input: { range: "next_week" },
  expectAfterFix: { rows: [] },
  files: ["src/events.ts"],
  description:
    "Asking for next week's events makes event.list end with an error and a problem opens. The cause is that RANGE_RULES has no next_week entry, so rangeBounds reads undefined.offset and throws a TypeError. Asking for this week or all events still works.",
};
