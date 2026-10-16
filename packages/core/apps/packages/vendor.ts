// 설치 사본을 자기 완결로 만드는 규칙.
// 설치 사본(sdk/<name>/<version>/)은 앱 bundle 안에서 packages/ 저장소 없이 읽힌다. 그래서 사본이
// packages/sdk/<name> 밖의 소스를 가져오는 자리는 설치가 사본 안 vendor/로 함께 담고 specifier를
// 사본 안 상대 경로로 바꾼다. 원본 파일은 고치지 않고, 바꾼 byte가 사본의 hash가 된다.

export type SourceFile = { path: string; bytes: Uint8Array };



// @lophn/blueprint: 정본 검증기는 protocol/apps/blueprint의 의존성 없는 파일들이다(read.ts는 zod를 써서 뺀다).

// @lophn/cap-store: migration 단계 type과 `-- loss:` 읽기는 protocol/apps/activation의 zod 없는 한 파일이다.
// 그 파일이 쓰는 Result는 base의 두 파일이고, 파일 위치가 사본 안에서도 같은 상대 경로로 닿는다.

// @lophn/cap-problem: portable 보고 계약과 그 type이 쓰는 오류·Result type이다.

// 설치 사본의 한 부분이면서 catalog Package가 아닌 지원 소스다. 공용 UI Package가 import하는
// `@lophn/design`·`@lophn/wording`·`@lophn/chart`가 여기다. catalog에 등록하지 않고 같은 sdk/<name>/<version>/
// 자리에 읽기 전용으로 풀어 앱 import map이 푼다.

// `from`(사본 안 파일 경로)에서 `to`(사본 안 대상 경로)까지의 상대 specifier.

// 사본 파일의 specifier를 규칙대로 바꾼다. 따옴표로 둘러싼 문자열 그대로만 바꾼다.
