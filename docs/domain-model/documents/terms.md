---
type: domain-model
concerns: [documents/terms]
---
# documents/terms

context 하나의 용어집 항목(용어, 뜻, 정한 쪽)을 정의한다.

## GlossaryEntry (`trm`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `trm` ID | 아니오 | PK, 불변 | |
| `context` | `ctx` ID | 아니오 | → documents/contexts; 생성 뒤 고정 | 이 항목이 속한 context |
| `term` | string | 아니오 | 앞뒤 공백을 자른 길이 1~80자; 같은 context 안에서 대소문자 무시 유일 | 용어 |
| `meaning` | string | 아니오 | 앞뒤 공백을 자른 길이 1~1,000자 | 뜻 |
| `set_by` | `user \| agent` | 아니오 | agent는 Context Engineer만 | 마지막으로 정한 쪽 |
| `updated_at` | 시각 | 아니오 | 마지막 set의 event 시각 | |
| `revision` | event seq | 아니오 | 마지막 set의 seq | CAS 기준 |

상태는 없다. 항목은 있거나 지워져서 없다.

### 불변 조건

- 항목의 `context`는 바뀌지 않는다.
- 용어 비교는 앞뒤 공백을 자른 문자열에서 ASCII 대소문자만 같게 본다. 별칭·번역 관계·Unicode 정규화·다른 context와의 대응·상속은 없다. 용어는 입력한 대소문자 그대로 저장한다.
- 한 context의 항목은 200개 이하이다.
- `set_by`는 마지막으로 set한 command의 actor이다. 사람이 고치면 `user`가 된다.
- Context Engineer(`agent`)는 `set_by = user`인 항목을 set·remove할 수 없다. 사람이 항목을 set하면 `set_by`는 다시 `user`이다.
- context 보관은 항목을 지우거나 바꾸지 않는다.
- 이전 뜻의 이력은 두지 않는다. 지운 항목은 표에서 행이 사라진다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| GlossaryEntry | context 소속 | Context → documents/contexts | N:1 | 보관에도 항목 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `glossary_entries` | `id, context, term, meaning, set_by, updated_at, revision` | PK `id` | `(context, lower(term))` | `(context, lower(term))`로 읽기 순서 | context → documents/contexts; revision → platform/ledger |

`lower`는 ASCII 대문자만 바꾼다. 읽기 순서는 `lower(term)`의 바이트 순, 같으면 `id`이다. 변경과 event는 한 transaction이다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `glossary.set` | `user`, 허용된 Context Engineer `agent` | 새 항목이면 `id, context, term, meaning`; 기존 항목이면 `entry, term?, meaning?`; idempotency key | 새 항목이면 ID·용어 미존재, context당 200개 이하; 기존 항목이면 `base_revision`; agent는 `set_by = agent` 항목만 | `GlossaryEntrySet` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `glossary.remove` | `user`, 허용된 Context Engineer `agent` | `entry` | `base_revision`; agent는 `set_by = agent` 항목만 | `GlossaryEntryRemoved` | `not_found`, `conflict`, `forbidden` |

글자 수 상한 위반과 빈 값은 `invalid_input`, 같은 context의 용어 중복과 항목 200개 초과는 `conflict`이다. 이전 뜻으로 되돌리는 command는 없다. 같은 idempotency key의 되풀이는 처음 결과를 돌려준다(→ platform/ledger).

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `GlossaryEntrySet` | `trm` | `context, term, meaning, set_by, created`(새 항목이면 true) | 없음 |
| `GlossaryEntryRemoved` | `trm` | `context, term` | 없음 |

event의 actor와 시각이 "누가 언제"의 기록이다. 이전 뜻은 payload에 싣지 않는다. 용어집을 읽는 쪽(agent prompt 조립, Context 탭)은 event를 구독하지 않고 표를 읽는다(→ lophn-agent/harness/prompt-assemble, shell).

## 정책

- **읽기.** 한 context의 항목 전부를 읽기 순서로 한 번에 읽는다. cursor·page는 없다.
- **prompt 자료.** 읽은 결과를 agent prompt 자료에 싣는 시점·형식·고정 규칙은 lophn-agent/harness/prompt-assemble이 정한다. 이 concern은 읽기 순서와 값이 같은 항목에 같은 결과를 주는 것만 보장한다.
- **쓰기 범위.** 항목을 쓰는 actor는 `user`와 Context Engineer `agent`뿐이다. 다른 agent·coding agent는 읽기만 한다(→ lophn-agent/roles).
