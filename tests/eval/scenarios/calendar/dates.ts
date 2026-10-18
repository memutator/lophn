// calendar-api의 "다음 주 화요일" 후보 날짜. 사람과 Operator가 일요일에 "다음 주"를 다르게 읽을 수 있어
// 월요일 시작 주와 일요일 시작 주 두 규칙의 화요일을 모두 후보로 낸다(같으면 하나).

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${
    pad(date.getDate())
  }`;
}

export function nextWeekTuesdays(now: Date): string[] {
  const day = now.getDay(); // 0 일요일 ... 6 토요일
  const at = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const monStart = at(-((day + 6) % 7) + 8); // 이번 주 월요일 + 7일 + 화요일(1일)
  const sunStart = at(-day + 9); // 이번 주 일요일 + 7일 + 화요일(2일)
  const dates = [ymd(monStart), ymd(sunStart)];
  return dates[0] === dates[1] ? [dates[0]!] : dates;
}
