// 값과 판정. IO는 없다.

// 첫 공개 묶음에서 제공하지 않는 이름. cap-read-model은 앱 사이
// command 호출이 cap-tool과 apps/connections를 따르므로 만들지 않았다.

// 제공하지 않는 이름을 목록·안내가 제공한다고 쓰면 실패다.

// @me 이름이 있으면 @lophn보다 먼저 보여 준다.
export function byCatalogOrder(
  a: { name: string },
  b: { name: string },
): number {
  const aMe = a.name.startsWith("@me/");
  const bMe = b.name.startsWith("@me/");
  if (aMe !== bMe) return aMe ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
