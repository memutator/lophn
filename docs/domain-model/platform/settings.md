---
type: domain-model
concerns: [platform/settings]
---
# platform/settings

공개 설정 항목의 schema, 사용자 선택·적용 판과 검증·병합 규칙을 정의한다.

## SettingDefinition (값)

항목의 뜻과 실제 허용값은 항목을 소유한 concern이 정한다. 이 값은 공통 등록 모양이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | 등록된 항목 경로; unique | 항목 |
| `owner` | concern ID | 아니오 | 실제 항목 정의 concern | 소유 |
| `description` | string | 아니오 | 비어 있지 않음 | 설명 |
| `value_type` | 값 schema | 아니오 | string·integer·number·boolean·array·object와 소유 concern의 구조 | 값 종류 |
| `default` | 해당 타입 값 | 예 | default 없음이면 null; secret 원문 불가 | 내장 기본값 |
| `required` | boolean | 아니오 | required이고 default 없음이면 사람 선택 필수 | 필수 여부 |
| `constraints` | JSON object | 아니오 | enum·숫자 범위·단위·대상 참조·관계 검사 선언 | 값 제약 |
| `layers` | `common` / `role`의 집합 | 아니오 | role 허용은 소유 concern이 명시한 항목만 | 허용 사용자 층 |
| `apply_at` | `next_run` / `current_check` / `next_call` | 아니오 | 소유 concern이 정한 적용 시점 | 효력 |

provider 정의·credential은 → lophn-agent/harness/provider, model catalog·slot은 → lophn-agent/harness/model이다. 역할별 model slot override는 허용하지 않는다. eval 설정은 제품 일반 설정에 등록하지 않는다.

## SettingChoice (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `layer` | `common` / `role` | 아니오 | definition이 허용한 층 | 선택 층 |
| `role_key` | string | 아니오 | common은 빈 문자열, role은 `rol` ID(→ lophn-agent/role-definition) | 층 대상 |
| `key` | string | 아니오 | 등록된 SettingDefinition.key | 항목 |
| `value` | 해당 타입 값 | 아니오 | 엄격 schema 검사; null 선택 불가; false·빈 목록은 명시값 | 사용자 선택 |

삭제는 이 층의 선택 부재이며 아래 층을 따른다. 적용값을 사용자 선택으로 다시 저장하지 않는다.

## SettingChange (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `layer` | `common` / `role` | 아니오 | 허용된 사용자 층 | 변경 층 |
| `role_key` | string | 아니오 | common은 빈 문자열, role은 `rol` ID | 변경 대상 |
| `key` | string | 아니오 | 등록 항목 | 변경 key |
| `before` | 해당 타입 값 | 예 | null은 이전 선택 없음; secret 원문 불가 | 이전 선택 |
| `after` | 해당 타입 값 | 예 | null은 선택 삭제; secret 원문 불가 | 새 선택 |

## SettingsRevision (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `revision` | integer | 아니오 | 0은 선택 없는 시작; 변경마다 증가·재사용 금지 | 설정 판 |
| `previous_revision` | integer | 예 | 초기 revision 0만 null; 이후 직전 판 | 이전 판 |
| `changes` | SettingChange 목록 | 아니오 | 빈 목록 허용; 같은 layer·role_key·key 중복 없음 | 변경 목록 |
| `affected_roles` | `rol` ID 목록 | 아니오 | common이면 모든 영향 역할, role이면 해당 역할 | 영향 범위 |
| `defaults_revision` | string | 아니오 | 내장 기본값·등록 schema 판 | 해석 기준 |
| `actor` | Actor | 아니오 | user 적용 또는 machine 다시 읽기 | 변경 주체 |
| `at` | 시각 | 아니오 | → platform/ledger | 확정 시각 |

판 record는 불변이고 사용자 선택의 이력을 복원할 수 있어야 한다. 기본값 변경으로 적용값이 바뀐 다시 읽기도 판과 event를 남기며, 선택과 적용값 모두 같으면 새 판을 만들지 않는다.

## SettingsState (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `singleton` | literal integer `1` | 아니오 | PK; record 하나만 | 전역 설정 key |
| `revision` | integer | 아니오 | 현재 성공 판; 초기 선택 없는 판은 0 | 적용 판 |
| `defaults_revision` | string | 아니오 | 해당 판을 검증한 내장 registry 판 | 기본값 판 |

## EffectiveSetting (값)

메모리의 병합·검증 결과다. ledger 원본 표가 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | 등록 항목 | 항목 |
| `role` | `rol` ID | 예 | common 조회는 null | 적용 대상 |
| `value` | 해당 타입 값 | 예 | 필수 선택이 비어 있으면 null이며 해당 기능 시작 불가 | 적용값 |
| `source_layer` | `builtin` / `common` / `role` | 예 | value 없음이면 null | 이긴 층 |
| `choices` | 층별 명시 선택 목록 | 아니오 | secret 원문 제외; 위·아래 선택 표시 | 선택 근거 |
| `revision` | integer | 아니오 | 현재 성공한 적용 판 | 적용 판 |
| `apply_at` | 적용 시점 값 | 아니오 | definition과 같음 | 효력 |

## SettingsValidationError (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | 잘못된 항목의 안전한 이름 | 오류 항목 |
| `layer` | `common` / `role` | 아니오 | 입력한 층 | 오류 층 |
| `role` | `rol` ID | 예 | role 층만 값 | 오류 역할 |
| `expected` | string | 아니오 | 기대 타입·enum·범위·단위 | 제약 |
| `remedy` | string | 아니오 | 원문 문서·secret 값 없는 설명 | 고칠 방법 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `setting_choices` | 현재 SettingChoice | `(layer, role_key, key)` | PK | `(key)` | role_key의 조건부 `roles.id` 참조는 모듈 검증; key는 설치된 registry 검증 |
| `setting_revisions` | 불변 SettingsRevision | `revision` | PK | `(at)` | `previous_revision → setting_revisions.revision`; affected_roles는 `roles.id` 검증; UPDATE·DELETE 금지 |
| `settings_state` | 현재 적용 판·defaults_revision | singleton key `1` | PK; CHECK key=1 | 없음 | `revision → setting_revisions.revision`; 선택 없는 시작 revision 0은 초기 record |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `ApplySettings` | user | 전체 set·delete 변경 목록, 준비된 검증 메타데이터 | 편집 시작 revision·registry 판; 모든 영향 역할 재검증 | `SettingsChanged` 또는 unchanged | `invalid_input`, `unauthorized`, `forbidden`, `conflict`, `unavailable` |
| `ReloadSettings` | user / machine | 현재 저장 선택·내장 registry의 재검증 결과 | 준비한 revision·defaults_revision | `SettingsReloaded` 또는 unchanged | `invalid_input`, `unauthorized`, `forbidden`, `conflict`, `unavailable` |

TOML parse·큰 검증 준비는 command 밖에서 한다. command는 현재 판과 작은 준비 참조를 확인하고 선택·판·event를 한 transaction에 모두 저장하거나 모두 거절한다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SettingsChanged` | null(전역 공통 설정) | revision, 변경 key·층·전후 선택, affected_roles, 즉시·다음 적용 항목 | 각 설정 항목 소유 concern |
| `SettingsReloaded` | null(전역 공통 설정) | revision, defaults_revision, 바뀐 key, affected_roles, 적용 시점 | 각 설정 항목 소유 concern |

## 정책

- **층.** `builtin < common < role` 세 층만 있다. 작업 디렉터리·앱 문서·세션·환경 변수·CLI 일회 인자·외부 응답·assignment override는 일반 설정 층이 아니다.
- **병합.** object는 항목별 병합, scalar는 높은 층 값으로 교체, array는 높은 층 전체로 교체한다. 목록 연결·중복 제거·문자열 숫자 변환·오타 자동 수정은 하지 않는다.
- **교환 format.** 일반 설정 import·export는 UTF-8 TOML 1.0만 쓴다. 환경 변수 치환·include·command 실행·원격 URL은 불가다. TOML 파일은 두 번째 원본이나 자동 감시 대상이 아니다.
- **검증.** 각 층의 문법·알려진 key·타입·범위·허용 층을 검사하고, 병합 뒤 필수값·항목 관계·참조를 검사한다. offline 미확인은 소유 concern이 허용한 때만 표시하고 받는다.
- **참조.** provider·catalog 보정은 common만이다. judgment·organizing slot은 common만이며 임의 provider·model·credential로 빈 필수값을 메우지 않는다.
- **변경.** 사람의 명시적 apply만 선택을 바꾼다. agent 제안·대화의 동의 추측·외부 문서 변경은 적용 요청이 아니다.
- **실패.** 적용·reload 실패는 마지막 유효 적용값과 판을 유지한다. 일부 항목만 적용하거나 default로 돌아가지 않는다. 첫 시작에 유효 판이 없으면 agent 작업은 막고 설정 수정·무관한 앱·문서 읽기는 허용한다.
- **run 판.** model·prompt·tool 목록·문맥·run 한도는 다음 run 시작부터 새 판을 쓴다. 진행 run은 시작 판을 유지하되 권한·안전의 현재 제한은 매 호출 현재값으로 검사한다.
- **안전.** secret 원문·API key·OAuth token·password·인증 header는 일반 설정으로 받지 않는다. 허용된 보호 참조만 가능하다. 어떤 층도 안전 금지·사람 결정·credential·외부 MCP의 경계를 해제하지 못한다.
- **연결.** 바뀌지 않은 provider·extension 연결을 reload 때문에 재연결하거나 lophn 전체를 재시작하지 않는다.

## 정할 것

- 설정 교환 문서의 format version과 옛 key의 명시 migration 모양.
- 자동 reload 여부. 현재는 명시 apply·reload만 정의한다.
- 소유 concern별 공개 key·기본값·범위·role 허용 목록. model slot·provider의 도메인 원본과 공통 선택을 이중 저장하지 않도록 해당 소유자와 맞춘다.
