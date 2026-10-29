// 대화 맨 아래 따라가기 규칙. 끄는 것은 사람이 위로 올리려는 입력이고, scroll 위치는 다시 켜기만 한다.
// scroll 위치로 끄면 맨 아래 여유 안의 작은 움직임(부드러운 wheel의 첫 0~1px)이 "맨 아래"로 읽히고, 그
// scroll이 부른 render가 맨 아래로 되돌려 wheel 한 칸이 통째로 먹혔다. 맨 아래 고정이 scrollTop을 올리므로
// scrollTop 차이로 방향을 읽어도 글이 자라는 동안 어긋났다.

/** 맨 아래로 보는 여유. 이만큼 안으로 내려오면 다시 따라간다. */
export const BOTTOM_SLACK = 24;

/** 위로 올리는 key. */
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** 이 입력 뒤에도 따라가는가. 이미 맨 위(scrollTop 0)라 올라갈 데가 없으면 그대로다. */
export function followAfterInput(
  following: boolean,
  input:
    | { kind: "wheel"; deltaY: number }
    | { kind: "key"; key: string; shiftKey: boolean }
    | { kind: "scrollbar" },
  scrollTop: number,
): boolean {
  if (!following || scrollTop <= 0) return following;
  switch (input.kind) {
    case "wheel":
      return input.deltaY >= 0;
    case "key":
      return !(UP_KEYS.has(input.key) || (input.key === " " && input.shiftKey));
    case "scrollbar":
      return false;
  }
}

/**
 * scroll 뒤에도 따라가는가. 아래로 움직여 맨 아래 여유에 들어오면 다시 따라간다. 창이 커져 대화가 다 들어오면
 * (맨 위이자 맨 아래) 올려 읽을 것이 없으니 따라간다. scroll로는 끄지 않는다.
 */
export function followAfterScroll(
  following: boolean,
  from: number,
  to: number,
  gap: number,
): boolean {
  return (
    following || (to > from && gap <= BOTTOM_SLACK) || (to <= 0 && gap <= 0)
  );
}
