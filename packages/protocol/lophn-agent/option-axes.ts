// effort 축 이름과 값 순서다. 화면(renderer)과 core가 같이 쓰므로 zod를 import하지 않는 순수
// TypeScript로 둔다. 값 schema는 resolved-model.ts·models.ts가 이 값으로 만든다.

// effort 축의 값 이름이다. 약한 값에서 강한 값 순서이고 model마다 이 가운데 지원하는 것만 선언한다(R15).
export const EFFORT_VALUES = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "very_high",
  "maximum",
] as const;

// 축 이름은 catalog 자료가 정하고 코드는 effort만 이름으로 안다. effort 값만 호출 형식의 표가
// 요청 필드로 옮기고(wire null), 나머지 축의 값은 자기 wire를 가진다.
export const OPTION_AXIS_EFFORT = "effort";
