// Claude Code의 folder trust 화면에서 지금 커서가 어디 있는지 읽는다. 다른 화면에는 null.
// 엉뚱한 화면에 Enter를 넣으면 사람의 권한 물음에 답해 버리므로, 물음과 선택지와 안내 줄이 모두 보일 때만 읽는다.
// Claude Code는 단어 사이를 cursor 이동으로 그려서 plain()을 거친 글에 공백이 없다. 그래서 공백을 모두 뺀 글로 비교한다.
// 기본 선택은 "No, exit"(1번)이라 아래로 한 칸 옮긴 뒤 Enter다.
export const DOWN = "\x1b[B";
export const ENTER = "\r";

const NO = "❯No,exit";
const YES = "❯Yes,Itrustthisfolder";

// 글은 시작부터의 PTY 출력 전부라 앞서 그려진 화면이 남아 있다. 그래서 선택 줄 둘 중 마지막에 나온 쪽이 지금 커서다.
export function trustCursor(screen: string): "yes" | "no" | null {
  const text = screen.replace(/\s+/g, "");
  const isTrust = text.includes("Isthisaprojectyoucreatedoroneyoutrust") &&
    text.includes("Yes,Itrustthisfolder") &&
    text.includes("Entertoconfirm");
  if (!isTrust) return null;
  const no = text.lastIndexOf(NO);
  const yes = text.lastIndexOf(YES);
  if (no === -1 && yes === -1) return null;
  return yes > no ? "yes" : "no";
}
