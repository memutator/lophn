// context.preview의 순수 부분: 만드는 중인 판(draft)을 지금 project 파일에 돌려 보기만 한다.
// job은 `context.preview`다.
import type { CheckFinding } from "../../../../protocol/projects/mod.ts";
import type { CheckInput, CheckViolation } from "../check/mod.ts";

// 격리 검사와 같은 입력에서 판(bundle)을 draft content로 바꾸고 사람이 저장한 saved view를 뺀 것이다.
// files는 worker가 계약이 가리키는 폴더를 복사해 고정한 snapshot이고 순수 함수는 그것만 읽는다.
export type PreviewInput = Omit<CheckInput, "bundle" | "user_saved_views"> & {
  // draft content JSON 그대로. 모양 검사는 안에서 한다.
  draft: unknown;
};

// 한 번에 다 낸 결과다. 문구(message)를 붙이고 위반을 30개씩 page로 자르는 일은 core 읽기가 한다.
export type PreviewOutcome = {
  // 계약의 type 순서로 type마다 지금 파일에서 뽑은 개체 수. app-data kind는 앱 read 명령을 부르지
  // 않으므로 0이다. 모양·의미 검사(1)(2)나 추출(3)에서 멈추면 [].
  types: { type: string; count: number }[];
  // 격리 검사의 (1)~(5)단계 finding과 같은 것(saved view는 판에 든 것만). 통과해도 finding이 없을 뿐
  // 위반은 센다.
  findings: CheckFinding[];
  // violations.length. 멈췄으면 0.
  violation_count: number;
  // path, kind, rule, section의 code unit 순. 격리 검사 `runCheck`의 violations와 같다.
  violations: CheckViolation[];
};
