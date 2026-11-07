// 앱 카드는 선언의 화면 가운데 card place를 선언한 것만 보인다.
// 없는 화면과 card place가 없는 화면은 같은 거절이라 받은 값을 알려 주지 않는다.
export function cardViewDeclared(
  screens: readonly { key: string; places: readonly string[] }[],
  view: string,
): boolean {
  return screens.some(
    (screen) => screen.key === view && screen.places.includes("card"),
  );
}
