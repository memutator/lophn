// 캘린더 앱에 일정을 만드는 호출(apps/connections#R1). 대상 앱 ID와 command는 blueprint의 app_connections와
// 같다. 앱 사이 호출은 lophn의 connectAppCommands 통로로만 가고 사람이 허락한 앱 쌍과 command 범위 안에서만
// 열린다. 허락이 없으면 없는 앱처럼 거절된다.
import { CommandRejection, connectAppCommands } from "@lophn/cap-schedule";
import { ADD_EVENT, CALENDAR_APP } from "./places.ts";

export type CalendarEvent = { title: string; starts_at: string };

// 캘린더가 일정을 만들었으면 그 결과를, 안 만들었으면 CommandRejection을 돌려준다. 호출은 갔지만 결과를 모르면
// 일반 오류를 던져 이 command의 결과도 모른다고 알린다(자동으로 다시 부르지 않는다).
export async function addCalendarEvent(
  event: CalendarEvent,
): Promise<unknown> {
  const connected = await connectAppCommands(CALENDAR_APP, [ADD_EVENT]);
  if (!connected.ok) throw refused(connected.error.code);
  const called = await connected.value.call(ADD_EVENT, event);
  if (!called.ok) throw refused(called.error.code);
  if (called.value.kind === "unknown") {
    throw new Error("the calendar did not confirm the event");
  }
  return called.value.result;
}

// 캘린더 쪽 오류의 안내 문장과 원문은 넘기지 않는다.
function refused(code: string): CommandRejection {
  return code === "forbidden" || code === "not_found"
    ? new CommandRejection(
      "forbidden",
      "the calendar app is not connected to this app",
    )
    : new CommandRejection("unavailable", "the calendar app is unavailable");
}
