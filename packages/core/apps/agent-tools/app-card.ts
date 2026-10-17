// 앱 카드는 blueprint 화면 가운데 card 크기를 선언한 것만 보인다.
// 없는 화면과 card 크기가 없는 화면은 같은 거절이라 받은 값을 알려 주지 않는다.
export function cardViewDeclared(
  screens: readonly { key: string; sizes: readonly string[] }[],
  view: string,
): boolean {
  return screens.some((screen) =>
    screen.key === view && screen.sizes.includes("card")
  );
}
