// 사용자 입력 활동 기록. 인터넷 page가 입력 없이 popup·dialog를 띄우지 못하게 하는 창이다.
// lophn(agent, 멀리서 보기)이 넣은 input도 popup·download에는 활동이다(agent가 login popup을 연다). OS 앱으로 넘기기(mailto 같은
// 바깥 link)는 이 컴퓨터 사람의 입력만 센다(freshPerson): agent의 click이 사람의 컴퓨터에서 다른 앱을 열면 안 된다.
export const ACTIVATION_WINDOW_MS = 5000;

/** 시각은 인자다. shell은 packages/base의 Clock을 import하지 못한다. */
export function createActivation(
  clock: { nowMs(): number },
  /** 지금 lophn이 이 contents에 input을 넣는 중이다(browser/agent/input.ts의 표시). */
  driven: (contentsId: number) => boolean = () => false,
) {
  const last = new Map<number, number>();
  const person = new Map<number, number>();
  const within = (at: number | undefined) => {
    if (at === undefined) return false;
    const age = clock.nowMs() - at;
    return age >= 0 && age < ACTIVATION_WINDOW_MS;
  };
  return {
    mark(contentsId: number): void {
      const now = clock.nowMs();
      last.set(contentsId, now);
      if (!driven(contentsId)) person.set(contentsId, now);
    },
    fresh: (contentsId: number): boolean => within(last.get(contentsId)),
    /** 이 컴퓨터의 사람이 방금 입력했다. OS 앱으로 넘기기는 이것만 본다. */
    freshPerson: (contentsId: number): boolean =>
      within(person.get(contentsId)),
    forget(contentsId: number): void {
      last.delete(contentsId);
      person.delete(contentsId);
    },
  };
}
