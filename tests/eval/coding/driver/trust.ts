// Claude Code의 folder trust 화면이면 "Yes, I trust this folder"를 고르는 키를 낸다. 다른 화면에는 null.
// 엉뚱한 화면에 Enter를 넣으면 사람의 권한 물음에 답해 버리므로, 선택지와 안내 줄이 모두 보일 때만 낸다.
// 기본 선택은 "No, exit"(1번)이라 아래로 한 칸 옮긴 뒤 Enter다.
const DOWN = "\x1b[B";
const ENTER = "\r";

export function trustKeys(screen: string): string[] | null {
  const isTrust =
    screen.includes("Is this a project you created or one you trust") &&
    screen.includes("Yes, I trust this folder") &&
    screen.includes("Enter to confirm");
  return isTrust ? [DOWN, ENTER] : null;
}
