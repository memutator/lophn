// `lucide:<이름>`의 kebab-case 이름을 lucide-react 모듈의 component로 푼다. shell이 그리는 것과 release 준비가 받는 이름
// 목록(tools/lucide-names.ts)이 같은 이 함수를 쓰므로, 받는 이름은 정확히 그릴 수 있는 이름이다.
// 숫자가 든 이름도 조각마다 첫 글자만 올리면 모듈 export와 맞는다(`axis-3d` → `Axis3d`, `clock-10` → `Clock10`).
export function lucideKey(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** 모듈에서 이름의 icon component를 찾는다. 없으면 undefined다. `Icon`·`icons` 같은 icon이 아닌 export는 거른다. */
export function lucideComponentOf(
  module: Record<string, unknown>,
  name: string,
): unknown {
  const found = module[lucideKey(name)];
  return typeof found === "object" && found !== null && "$$typeof" in found
    ? found
    : undefined;
}
