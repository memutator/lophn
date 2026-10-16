// 정확한 import map. 앱이 고르는 설치 SDK Package에서 시작해, 설치 사본의
// 소스가 import하는 `@lophn/*`와 npm 의존을 끝까지 따라가 정확한 version 하나씩만 담는다. 사본 안에서
// 풀리지 않는 import와 같은 이름의 다른 pin은 import map을 만들지 않고 실패한다. 실행 때 새 패키지를
// 내려받거나 다른 version으로 바꾸지 않는다.
import { packageInstallPath } from "../install.ts";

type ImportMap = { imports: Record<string, string> };

// 줄 처음에서 시작하는 import·export ... from과 부수 효과 import, 동적 import만 읽는다. 문자열 안의
// 예시 문장은 읽지 않는다.

// 사본 안 상대 specifier가 가리키는 사본 경로. 사본 밖으로 나가면 undefined다.

// 공개한 export에서 상대 import를 따라 닿는 소스만 읽는다. 시험·예제·내보내지 않는 도우미는 앱이
// 불러오지 않는다. 사본 밖으로 나가거나 사본에 없는 상대 import는 실패다.

// 설치 사본에서 정확한 import map을 만든다. `lophn-sdk:<name>@<version>/<경로>`와 정확한 `npm:` pin만
// 담고 ^·~·latest는 만들지 않는다.

// 앱 deno.json의 `lophn-sdk:` 값을 설치 사본(`<dataRoot>/<packageInstallPath>`)의 file URL로 바꾼 개발용 import
// map이다. 상대 경로 값은 앱 폴더 기준 file URL로 바꾼다(map 파일은 `.lophn/`에 있다). 이 map은 이 장치의 설치
// 위치를 담으므로 앱 source에 넣지 않는다.
export function devImportMap(
  imports: Readonly<Record<string, string>>,
  dataRoot: string,
  appDir: string,
): ImportMap {
  const dataBase = `file://${dataRoot.replace(/\/?$/, "/")}`;
  const appBase = `file://${appDir.replace(/\/?$/, "/")}`;
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(imports)) {
    const sdk = /^lophn-sdk:(@[^/@]+\/[^/@]+)@([^/@]+)(?:\/(.*))?$/.exec(value);
    const installed = sdk === null
      ? undefined
      : packageInstallPath(sdk[1], sdk[2]);
    mapped[key] = sdk !== null && installed?.ok === true
      ? new URL(`${installed.value}/${sdk[3] ?? ""}`, dataBase).href
      : value.startsWith("./") || value.startsWith("../")
      ? new URL(value, appBase).href
      : value;
  }
  return { imports: mapped };
}
