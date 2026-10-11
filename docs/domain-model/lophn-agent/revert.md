---
type: domain-model
concerns: [lophn-agent/revert]
---
# lophn-agent/revert

session 안 사람 메시지마다의 Checkpoint, 문서 tool이 쓰기 직전에 남기는 RewindFile 기록, 되돌리기 시도(Revert)와 그 preview·복원 결과를 정의한다.

## Checkpoint (`msg` ID로 식별)

run을 시작하는 사람 메시지 하나가 Checkpoint 하나다. 별도 ID를 만들지 않고 Message의 ID를 키로 쓴다. → lophn-agent/conversation

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `message` | `msg` ID | 아니오 | PK; `mode=request`인 사람 메시지만; correction·agent·machine 메시지와 Fork 복사본은 checkpoint가 아니다 | 되돌아갈 지점 |
| `session` | `ses` ID | 아니오 | 메시지의 session; → lophn-agent/conversation | 소속 |
| `files_restorable` | boolean | 아니오 | 초기 true; false가 되면 다시 true가 되지 않음 | 문서 파일 복원 가능 여부 |
| `files_reason` | `limit_total / limit_file / limit_count` | 예 | `files_restorable=false`일 때만 필수 | 복원 불가 이유 |

- 메시지를 접수하면서 같은 transaction에서 만든다(`ReceiveMessage`의 mode=request). 순서는 메시지의 생성 seq다.
- correction 메시지는 checkpoint가 없다. 그 메시지로 rewind하면 "대화만"(`messages_only`)만 허용한다.
- `files_restorable=false`: 한도(요구 R14)로 pre-image를 다 두지 못한 checkpoint. 최근 100개를 넘어 밀려난 가장 오래된 checkpoint(`limit_count`), session당 200 MB를 넘어 밀려난 가장 오래된 checkpoint(`limit_total`), 그 checkpoint 안에서 파일당 10 MB를 넘는 쓰기가 있었던 checkpoint(`limit_file`). 이 checkpoint로는 `restore_all`을 고를 수 없다. 이후 checkpoint로 하는 rewind가 같은 경로의 이 기록을 지나가면 그 경로는 건너뛴다(RewindFile 참조).

## RewindFile

문서 tool이 문서 파일을 쓰기 직전에 tool call마다 한 줄 남기는 기록이다. pre-image 내용은 아래 저장 정책의 session 저장소에 둔다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `tool_call` | `tcl` ID | 아니오 | PK 일부; 문서 쓰기 tool call; → lophn-agent/harness/tools | 쓴 호출 |
| `path` | 문자열 | 아니오 | PK 일부; project 폴더 기준 상대 경로(원본 연결 없는 문서는 그 문서의 작업 사본 경로); 정규화됨 | 쓴 파일 |
| `checkpoint` | `msg` ID | 아니오 | 그 tool call이 속한 run의 시작 메시지; → Checkpoint | 소속 checkpoint |
| `seq` | event seq | 아니오 | 쓴 순서; → platform/ledger | 같은 경로의 순서 |
| `before` | FileState | 아니오 | 쓰기 직전 상태; 이 call 자신의 것(앞 call의 `after`와 같은 내용이면 같은 저장물) | 쓰기 전 |
| `after` | FileState (`blob` 없음) | 아니오 | 쓴 뒤 상태의 hash | 쓰기 후 |
| `moved_from` | 문자열 | 예 | 이름 변경이면 옛 경로; 그때 `before`는 옛 경로의 내용이다 | 이름 변경 |
| `reverted_by` | `rvt` ID | 예 | 이 기록을 되돌린 Revert; 설정되면 이후 판정의 사슬에서 빠진다 | 되돌려짐 |

### FileState (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `exists` | boolean | 아니오 | false이면 sha256·blob 없음(만들기 전 또는 삭제 뒤) | 파일이 있었나 |
| `sha256` | sha256 | 예 | exists일 때 필수 | 내용 hash |
| `blob` | session 저장소 항목 | 예 | `before`에서 exists이고 한도 안일 때만; 한도를 넘으면 null(`unrecorded`) | 저장된 pre-image |

### 불변 조건

- 문서 tool이 쓰기 직전에 `before`를 읽고, 쓴 직후에 `after`를 채운다. 기록 없이 쓴 파일은 없다. 기록에 실패해도 쓰기를 막지 않고 그 checkpoint를 `files_restorable=false`로 낮춘다(요구 R14).
- `before.blob=null`이면서 `before.exists=true`인 기록은 pre-image를 못 둔 쓰기다. 이 경로의 사슬은 거기서 끊겨 이 쓰기를 지나는 복원은 그 경로를 건너뛴다(`no_pre_image`).
- 같은 경로의 기록은 `seq` 순서로 사슬이다. 앞 기록의 `after.sha256`과 뒤 기록의 `before.sha256`이 같으면 이어진 것이다. 다르면 그 사이 사람이 고친 것이다(끊김). 이름 변경 기록은 `moved_from` 경로의 사슬 끝과 `path`의 사슬 시작을 잇는다.
- 같은 내용(sha256)은 session 안에서 한 번만 저장한다. 총량은 서로 다른 저장물의 크기 합이다.
- `reverted_by`가 설정된 기록은 이후 어떤 판정의 사슬에도 들지 않는다. 설정은 한 번이다.
- 기록은 수정·삭제하지 않는다. 지우는 것은 한도 정리, session 삭제·닫힘, 되돌린 기록의 정리뿐이다.

## Revert (`rvt`)

rewind 한 번 또는 Undo 한 번의 시도다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `rvt` ID | 아니오 | PK; 최초 시도 전 고정; 결과 불변 | 되돌리기 시도 |
| `session` | `ses` ID | 아니오 | 열린 session; → lophn-agent/conversation | 소속 |
| `kind` | `rewind / undo` | 아니오 | 불변 | checkpoint 되돌리기 / 편집 카드 하나 |
| `choice` | `restore_all / messages_only / summarize` | 예 | `kind=rewind`에 필수; undo는 null | 고른 범위 |
| `checkpoint` | `msg` ID | 예 | `kind=rewind`에 필수; → Checkpoint | 돌아갈 메시지 |
| `tool_call` | `tcl` ID | 예 | `kind=undo`에 필수; → RewindFile | 되돌린 편집 |
| `boundary_seq` | seq | 예 | rewind에 필수; checkpoint 메시지의 seq; 이 메시지부터 뒤가 숨김 구간(`summarize`는 접힘 구간) | 숨김 시작 |
| `summary_call` | `mcl` ID | 예 | `choice=summarize`에 필수; 완전 성공한 요약 call; → lophn-agent/harness/usage | 요약 근거 |
| `outcome` | `applying / applied / partial / uncertain / blocked` | 아니오 | applying에서 최종 결과로 한 번 바뀜; 최종 결과 불변 | 복원 진행·실제 결과 |
| `redo` | `none / available / done / closed` | 아니오 | 아래 규칙 | redo 가능 여부 |
| `items` | RevertItem 배열 | 아니오 | 사전 검사에서 정한 목록; 완료한 단계 결과는 불변 | 복원 대상별 결과 |
| `preview_hash` | sha256 | 아니오 | 사람 결정에 고정한 checkpoint·기록 목록·파일 현재 hash·앱 단계·실행 순서 | 재시작·재검사 기준 |
| `result_seq` | event seq | 예 | applying만 null; → platform/ledger | 결과 event |

시도 actor·시각은 event에서 읽는다. 앱 direct call이 있으면 applying 상태를 durable하게 기록하고 실제 호출은 apps/invocations로 추적한다.

### 상태

| 상태 | 뜻 |
|---|---|
| applying | 사전 검사·사람 결정 저장 뒤 앱 복원 진행; 최종 결과 아님 |
| applied | 복원 대상으로 정한 것 모두 확인; 건너뛴 파일·남는 영향은 `items`에 이유와 함께 있음 |
| partial | 앱 복원 도중 실패·새 충돌로 이미 복원한 것과 남은 것이 공존 |
| uncertain | 전달한 앱 복원의 효과를 확인할 수 없음; 추가 앱 호출 중단 |
| blocked | 아무것도 복원하지 않음(오래된 preview·확인 부족·앱 사전 검사 실패로 대상 없음 등) |

`redo`: `none`(redo 없음 — undo, summarize, 앱 write를 되돌린 rewind, partial·uncertain, blocked), `available`(숨긴 메시지와 복원한 파일을 되돌릴 수 있음), `done`(redo함), `closed`(다음 사람 메시지 접수로 확정되어 redo 끝).

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | applying | `user` | session 열림·미종료 run 없음·사전 검사·preview_hash 일치; 앱 복원 단계 존재 | `RevertStarted` |
| applying | applied / partial / uncertain | `machine`(사람 결정에 묶임) | 앱 결과 확인 뒤 문서 파일 복원 판정·쓰기·결과 저장 | `RevertApplied / RevertFinished` |
| 없음 | applied | `user` | 앱 단계 없음; 문서 파일 복원 판정·쓰기 완료; `messages_only`·`summarize`·undo 포함 | `RevertApplied` |
| 없음 | blocked | `user` | stale preview·확인 부족·session 상태 불일치 | `RevertBlocked` |
| `redo=available` | `done` | `user` | 다음 사람 메시지 전; 복원했던 파일의 지금 hash가 복원한 내용과 같은 것만 | `RevertRedone` |
| `redo=available` | `closed` | `machine` | 같은 session의 다음 사람 메시지 접수와 같은 transaction | `RevertClosed` |

### 불변 조건

- 같은 session의 applying Revert는 하나다. 새 시도는 앞선 applying이 끝난 뒤에만 한다. 같은 command 재전송은 저장된 현재 결과를 반환하고 원래 앱 write를 다시 하지 않는다.
- 사람만 요청한다. machine은 그 결정에 묶인 검사·복원 함수만 처리하고 actor는 user다. agent는 revert command를 내지 못한다.
- 숨김은 Message를 바꾸지 않는다. 숨김 구간은 `choice`가 `restore_all`·`messages_only`이고 outcome이 applied·partial·uncertain인 rewind의 `boundary_seq` 이후 메시지로 읽는다(`redo=done`이면 다시 보인다). 숨긴 메시지·질문 답·승인 결정·호출 결과·사용량·run 기록은 수정하거나 지우지 않는다. 숨긴 구간은 이후 model 입력에 들지 않는다(→ lophn-agent/harness/prompt-assemble).
- 여러 rewind가 겹치면 가장 앞선 `boundary_seq`가 숨김 시작이다. 이미 숨긴 구간 안의 checkpoint는 고를 수 없다.
- `redo=available`이 되는 것은 `kind=rewind`이고 `choice`가 `restore_all`·`messages_only`이며 앱 복원 단계가 없는 `applied`뿐이다. `restore_all`에서 파일을 복원할 때는 복원 직전 내용을 session 저장소에 따로 두어 redo의 근거로 쓰고 `closed`가 되면 지운다.
- `choice=summarize`는 문서·앱·메시지 어느 것도 바꾸지 않는다. 뒤 구간을 요약으로 접어 model 입력에 쓰고 원문은 읽힌다. 요약이 실패하면 아무것도 바뀌지 않는다.
- undo는 대화를 숨기지 않는다. `RevertApplied`와 함께 session에 사실 메시지("Undid edit to <경로>")를 machine이 남기고 다음 model call의 입력에 든다.
- 결과·원래 event·답·승인·호출·사용량은 수정하거나 지우지 않는다. 새 복원 event의 run은 null이다.

## RevertPreview (값)

Checkpoint·RewindFile·소유 concern의 복원 검사에서 만든 읽기 결과다. 정본 entity나 저장된 목록이 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind / choice / checkpoint / tool_call` | Revert와 같음 | | 고른 범위 | 무엇을 되돌리나 |
| `as_of_seq` | event seq | 아니오 | 같은 읽기 snapshot의 head; → platform/ledger | 조회 기준 |
| `restore` | RevertItem 배열 | 아니오 | 복원 대상(`class=file / app`) | 복원할 것 |
| `skip` | RevertItem 배열 | 아니오 | 건너뛰는 것 — 사람이 고친 파일, symlink·hard link, pre-image 없음 | 건너뛰는 것 |
| `remain` | RevertItem 배열 | 아니오 | 남는 영향 — receipt 없는 앱 write, 이미 한 외부 요청·메일, secret 사용, 질문 답·승인 결정 | 되돌려지지 않는 것 |
| `redo` | boolean | 아니오 | redo 가능 여부 예고; 앱 복원이 있으면 false | redo 예고 |
| `preview_hash` | sha256 | 아니오 | 위 내용과 파일 현재 hash의 고정 지문 | 결정 기준 |

## RevertItem (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `ordinal` | integer | 아니오 | Revert 안 unique; 0 이상 | 순번 |
| `class` | `file / app / fact` | 아니오 | 문서 파일 / 앱 write / 남는 사실 | 대상 종류 |
| `target` | 문자열 | 아니오 | file은 경로, app은 원래 ToolCall ID, fact는 사실 종류 | 대상 |
| `source` | `tcl` ID 배열 | 아니오 | 원래 tool call; 앱은 원래 호출 | 출처 |
| `plan` | `restore / skip / remain` | 아니오 | 사전 검사 결과 | 계획 |
| `result` | `restored / skipped / remained / failure / uncertain / unchanged` | 아니오 | 아래 조합만 | 실제 결과 |
| `reason` | 이유 코드 | 예 | `plan≠restore`이거나 result가 restored 아님이면 필수; 고정 코드(contracts의 revertReasonSchema) | 설명 |
| `app_revert` | AppRevertBinding | 예 | `class=app`에 필수 | 앱 복원 근거 |

| 이유 코드 | 뜻 |
|---|---|
| `edited_outside` | 지금 hash가 agent가 마지막으로 쓴 내용과 다름(사람이 고침); 건너뜀 |
| `chain_broken` | 같은 경로의 기록 사이에 사람이 고친 흔적이 있음; 건너뜀 |
| `no_pre_image` | 한도로 pre-image를 두지 못함; 건너뜀 |
| `link_path` | symlink·hard link 경로; 건너뜀 |
| `rename_blocked` | 이름 변경의 옛 경로에 다른 파일이 있음; 건너뜀 |
| `created_edited` | agent가 만든 파일을 사람이 고쳐 지우지 않음; 건너뜀 |
| `no_receipt` | 앱 write에 revert receipt가 없음; 남는 영향 |
| `no_revert_command` | 앱이 revert command를 선언하지 않음; 남는 영향 |
| `app_revision_changed` | 앱 현재 revision이 receipt 기준과 다름; 같은 앱의 더 앞선 단계도 부르지 않음 |
| `external_effect` | 이미 나간 외부 요청·activation·secret 사용; 남는 영향 |
| `already_reverted` | 이미 Undo한 기록; unchanged |
| `answered_fact` | 질문 답·승인 결정·호출 결과·사용량; 지우지 않고 숨김 구간에 남음 |

| plan | result | 조건 |
|---|---|---|
| restore | restored | 파일은 `before`로 교체하거나 지움, 앱은 revert command 성공 |
| restore | failure / uncertain / unchanged | 실제 앱 결과 또는 미시작을 구별(첫 앱 복원 뒤 실패면 뒤 단계는 unchanged) |
| skip | skipped | 이유 코드 필수; 덮어쓰지 않음 |
| remain | remained | 이미 있는 영향; 되돌렸다고 쓰지 않음 |

`items`는 시도 결과와 event 연결이며 원래 내용 복사본이 아니다.

## AppRevertBinding (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app / release / command` | ID / ID / 문자열 | 아니오 | 원래 ToolCall.app_command와 일치 | 원래 호출 계약 |
| `tool_call` | `tcl` ID | 아니오 | checkpoint 이후의 성공 write; → lophn-agent/harness/tools | 출처 |
| `invocation` | `inv` ID | 아니오 | 성공 출력의 revert.invocation; → apps/invocations | 원래 업무 변경 |
| `receipt` | 불투명 문자열 | 아니오 | 앱이 돌려준 값 그대로; model에 원문 제공 없음 | 복원 입력 근거 |
| `expected_revision` | 앱 revision | 아니오 | 원래 성공 receipt 기준; 앱 소유 CAS | 후속 변경 검사 |
| `revert_command` | command key | 아니오 | 원래 blueprint.command.revert.command 검증; → apps/blueprint | 앱 복원 API |
| `step_key` | 문자열 | 아니오 | `(revert ID,원래 invocation ID)`의 고정 idempotency key | 복원 중복 방지 |
| `revert_invocation` | `inv` ID | 예 | apps/invocations에서 step_key로 조회 | 실제 복원 기록 |

preview는 receipt 원문을 UI·model에 보여 주지 않고 앱·command·변경 설명·복원 가능 여부·revision만 보여 준다. 앱이 복원 사전 검사·CAS·idempotency/result query를 지원하지 않으면 이를 알리고 안전한 복원으로 분류하지 않는다. 앱 source·DB 파일 직접 쓰기가 아니라 선언된 command만 호출한다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Checkpoint | 메시지 | → lophn-agent/conversation의 Message | 1:1 | session을 delete하면 함께 지움 |
| RewindFile | checkpoint | Checkpoint | N:1 | checkpoint를 지우면(한도 정리·session 삭제·닫힘) 함께 지움 |
| RewindFile | 쓴 호출 | → lophn-agent/harness/tools의 ToolCall | 1:1 | session을 delete하면 함께 지움 |
| Revert | session | → lophn-agent/conversation | N:1 | session을 delete하면 함께 지움 |
| Revert | 돌아간 checkpoint / 되돌린 call | Checkpoint / RewindFile | N:0..1 | 한도 정리 뒤에도 결과 기록은 남음 |
| RevertItem | 원래 사실·실제 보상 | → platform/ledger, apps/invocations | 1:0..N | event 삭제 금지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `checkpoints` | Checkpoint | `message` PK | PK | `(session, message)`; `(session, files_restorable)` | message FK → lophn-agent/conversation의 `messages.id`; session FK |
| `rewind_files` | RewindFile 한 줄(FileState hash·저장물 key 포함) | `(tool_call, path)` PK | PK | `(checkpoint, path, seq)`; `(path, seq)`; `(reverted_by)` | tool_call FK → lophn-agent/harness/tools; checkpoint FK → `checkpoints.message`; reverted_by FK → `reverts.id` |
| `reverts` | Revert 헤더 | `id` PK | partial session WHERE outcome='applying'; `result_seq` | `(session, result_seq)`; `(session, redo)` | session FK; checkpoint FK; result_seq FK → `events.seq`(platform/ledger) |
| `revert_items` | RevertItem의 class·target·plan·result·reason·AppRevertBinding | `(revert, ordinal)` PK | PK | `(class, target)` | revert FK → `reverts.id`; reason은 고정 코드 |

최종 결과 행은 불변이다. `reverts`에 preview_hash를, `revert_items`에 AppRevertBinding·단계 결과를 담는다. 단계 계획은 RevertStarted 때 만들고 checkpoint는 아직 미확정 단계의 결과만 CAS로 한 번 설정한다. applying 헤더는 최종 outcome·result_seq로 한 번 바뀐다. 최종 결과·완료 단계는 덮어쓰지 않는다. `session`을 delete하면 `DeleteSession`이 같은 transaction에서 네 표의 행을 지운다. pre-image 내용은 ledger 표가 아니라 아래 session 저장소다.

## 저장 (session 저장소)

pre-image 내용과 redo용 복원 직전 내용은 platform/blob-store가 아니라 이 concern의 session 저장소에 둔다. blob-store의 영구 참조는 변경 기록의 근거라 session 수명에 맞춰 지울 수 없기 때문이다.

- 위치: data root 아래 session 단위 디렉터리(`<H>/rewind/<session ID>/`)이며 안에서 sha256으로 주소를 매기는 파일이다. 같은 내용은 하나다.
- 쓰기: 임시 파일에 쓰고 hash를 확인한 뒤 원자적으로 설치한다. rows 등록은 ledger transaction이고 파일 설치는 그 밖이라 공동 원자 작업이 아니다. 설치만 되고 row가 없는 저장물은 고아이며 시작 때와 주기로 쓸어낸다.
- 한도: 기록이 있는 checkpoint 최근 100개, 파일당 10 MB, session당 서로 다른 저장물 합 200 MB. 새 쓰기가 파일당 한도를 넘으면 저장하지 않고 그 checkpoint를 `limit_file`로 낮춘다. 개수나 합을 넘으면 가장 오래된 checkpoint의 기록과 저장물을 지우고 `limit_count` / `limit_total`로 낮춘다.
- 정리: 삭제는 (1) `reverted_by`가 설정된 기록은 그 Revert가 `redo=closed` 또는 `none`이 되면, (2) 한도 정리, (3) session 삭제·닫힘이다. archive는 지우지 않는다. 정리에 실패한 session 디렉터리는 시작 때와 주기로 다시 쓸어낸다.
- 읽기: 사람의 rewind·Undo 준비와 redo만 읽는다. agent·model·앱에는 내용도 경로도 주지 않는다.

## command

preview는 인증된 읽기이며 command나 domain event를 만들지 않는다. idempotency·입력 한도·공통 오류는 → platform/ledger.

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `RecordRewindFile` | agent(문서 tool의 harness) | tool_call, path, before FileState, after hash, moved_from? | 실행 중인 문서 쓰기 tool call; 같은 `(tool_call,path)` 중복은 기존 결과; 한도 판정은 이 command가 한다 | 없음(감사는 ToolCall event) | `invalid_input`, `conflict`, `unavailable` |
| `Rewind` | `user` | id, session, checkpoint, choice, preview binding_hash, 남는 영향 confirmation 증거 | session 열림·미종료 run 없음·checkpoint가 숨김 구간 밖·choice 허용(correction 메시지는 `messages_only`만, `files_restorable=false`는 `restore_all` 불가)·applying Revert 없음·preview_hash 일치 | `RevertStarted` 또는 `RevertApplied` 또는 `RevertBlocked` | `forbidden`, `not_found`, `invalid_input`, `conflict`, `unavailable` |
| `UndoEdit` | `user` | id, session, tool_call, preview binding_hash | session 열림·진행 중 run이 같은 경로를 쓰는 중이 아님·그 call의 `reverted_by` 없음·지금 hash == 그 call의 `after`·같은 경로의 더 최근 기록 없음 | `RevertApplied` + 사실 메시지 | `forbidden`, `not_found`, `conflict`, `unavailable` |
| `Redo` | `user` | revert, 상태 seq | `redo=available`·다음 사람 메시지 전·복원했던 파일의 지금 hash가 복원한 내용과 같은 것만 | `RevertRedone` | `forbidden`, `not_found`, `conflict` |
| `CheckpointRevert` | machine | revert, step_key, 실제 Invocation·결과 | applying·고정 preview·단계 중복 없음; 저장한 사람 결정 근거 | 없음; 앱 사실은 → apps/invocations | `conflict`, `forbidden` |
| `FinishRevert` | machine | revert, 전체 단계 근거 | applying·문서 파일 판정 재검사·실제 앱 결과 | `RevertApplied / RevertFinished` | `conflict`, `forbidden` |

- 인증·형식·대상 없음·같은 id의 다른 입력·공통 크기 한도 오류는 command 거절이다. 유효한 새 시도의 도메인 충돌(오래된 preview·확인 부족)은 정상 확정된 blocked 결과와 event다.
- 오래된 preview면 고정 내용을 적용하지 않고 현재 판정의 blocked 결과를 저장한다. 사람이 본 내용을 조용히 고쳐서 적용하지 않는다. confirmation 증거 자체의 불일치는 forbidden/conflict다.
- 문서 파일 복원은 앱 단계가 끝난 뒤에 한다. 앱 단계가 없으면 한 번에 판정·교체하고 `RevertApplied`를 확정한다. 앱 단계가 있으면 먼저 사전 검사와 `RevertStarted`/applying을 확정하고 runtime이 앱 revert command를 부르며 network를 writer transaction 안에서 기다리지 않는다.
- 파일 쓰기·hash 계산·pre-image 복사는 transaction 밖의 준비다. 준비가 없이는 성립하지 않는 복원을 restored로 기록하지 않는다.
- 다음 사람 메시지를 접수하는 `ReceiveMessage`는 같은 transaction에서 `redo=available`인 Revert를 `closed`로 바꾸고 `RevertClosed`를 낸다(요구 conversation#R25).
- 앱 호출 시작 뒤 앱의 새 충돌·실패·효과 불명은 partial/uncertain이며, 이미 복원한 앱 효과를 롤백했다고 주장하지 않는다. 이 경우 문서 파일 복원은 시작하지 않고 `unchanged`로 남긴다(앱 효과가 불명확한 채 문서만 되돌려 상태가 어긋나는 것을 막는다).

### 앱 복원 실행 경계

`Rewind`는 앱 단계가 있으면 durable applying 접수 결과를 반환한다. runtime은 저장한 preview_hash와 AppRevertBinding을 읽고 `step_key`로 이미 수행한 복원 Invocation을 먼저 조회한다. 원래 write 역순으로 앱 revert command를 호출하며 사람 복원 결정·현재 앱 존재·release 계약·CAS를 검사한다. agent.commands Grant를 복원 권한으로 복사하지 않고 사용자 결정에 묶인 user actor의 앱 통로를 사용한다. 각 결과는 원래 receipt 및 revert ID에 묶어 `CheckpointRevert`로 남긴다. 이미 전달된 효과가 불명확하면 result query 외 재송신하지 않는다. 앱 단계가 모두 성공하면 `FinishRevert`가 문서 파일 판정을 다시 검사하고 파일 복원과 최종 결과를 확정한다.

이어 실행은 core의 `RunAppRevert`(사람 자격의 core 메모리 route)다. rewind 창이 `Rewind`의 applying 접수 뒤 이 route를 부르면 core가 위 순서를 이어 받는다: 앱 호출은 호출한 사람의 `apps/connect` 연결과 앱 direct socket(`request_key`=step_key), 단계 기록·끝내기는 core 내부 machine 자격이다(사람 token은 `CheckpointRevert`·`FinishRevert`를 직접 부르지 못한다). `CheckpointRevert.invocation`은 앱의 revert command 호출이 남긴 실제 Invocation(닿지 못했거나 응답을 잃었으면 null)이고 단계 근거의 `revert_invocation`에 남으며 원래 write의 invocation은 `invocation`에 그대로 있다.

이 machine 작업은 등록한 사람 결정의 복원 동작만 수행하며 새 agent run·model 판단을 만들지 않는다. 최종 event actor=user/run=null이다. 앱 revert command 자체가 confirm이면 원래 write approval을 재사용하지 않고 해당 owner의 새 정확한 사람 확인을 요구한다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `RevertStarted` | revert | `session`, `kind`, `choice`, preview_hash, 전체 앱 단계 참조 | lophn-agent/revert, shell/desktop |
| `RevertFinished` | revert | `session`, outcome=partial/uncertain, 결과별 항목 수(`results`) | lophn-agent/observability, shell/desktop |
| `RevertApplied` | revert | `session`, `kind`, `choice`, `partial: boolean`(건너뜀·남는 영향이 있었나), 결과별 항목 수(`results`), `boundary_seq?`, `redo` | lophn-agent/observability, shell/desktop; lophn-agent/harness/prompt-assemble |
| `RevertBlocked` | revert | `session`, 결과별 항목 수(`results`) | lophn-agent/observability, shell/desktop |
| `RevertRedone` | revert | `session`, 다시 보인 메시지 수, 복원한 파일 수 | shell/desktop, lophn-agent/harness/prompt-assemble |
| `RevertClosed` | revert | `session`, redo 끝난 시각 | shell/desktop |

복원 event의 actor는 user(Closed는 machine), envelope run은 null이다. 목록 항목 사본은 싣지 않고 `rewind/list`가 읽는다.

## 정책

- **session 수명.** Revert·RewindFile·pre-image는 session이 열려 있는 동안만 의미가 있다. 닫힘(assignment 회수)·delete 때 전부 지운다. archive는 session 안 일을 바꾸지 않으므로 남긴다. Fork는 확정 메시지만 복사하며 Checkpoint·RewindFile·Revert를 옮기지 않는다. 복사본의 메시지에서는 checkpoint가 생기지 않는다(`copied_from`이 있는 메시지). → lophn-agent/conversation
- **판정 규칙 (문서 파일).** 대상 경로마다 선택한 checkpoint 이후의 `reverted_by`가 없는 RewindFile을 `seq` 순서로 모아 사슬을 확인한다. 현재 파일 hash가 마지막 기록의 `after`와 같고 사슬이 이어져 있으면 복원: 첫 기록의 `before`로 교체하고 `before.exists=false`면 지운다. 현재 파일이 없고 마지막 `after.exists=true`면 첫 `before`로 되살린다. 위가 아니면 건너뜀 이유 코드를 단다. `before.exists=false`인데 현재 hash가 다르면 지우지 않는다(`created_edited`). 이름 변경은 옛 경로에 `before`를 쓰고 새 경로를 지운다. 옛 경로에 다른 파일이 있으면 건너뜀(`rename_blocked`). symlink·hard link 경로는 모두 건너뛴다.
- **복원 쓰기.** 사람이 시작한 동작이며 documents/file-tracking의 수정 전 hash 비교와 원자 교체를 따른다. agent·앱에는 이 통로가 없다. 복원은 watch에는 안정된 외부 변경으로 보인다.
- **복원이 남기는 것.** 복원한 RewindFile에 `reverted_by`를 설정한다. 복원은 새 기록이며 원래 tool call·메시지·답은 그대로다. 다음에 같은 경로를 agent가 쓰면 새 기록이 새 사슬을 시작한다.
- **Undo.** `kind=undo`는 같은 기록을 `(tool_call, path)` 하나 단위로 읽는다. 지금 hash == 그 call의 `after`이고 같은 경로에 더 최근 기록이 없을 때만 한다. 복원하면 `reverted_by`가 설정되어 이후 rewind에서는 `already_reverted`(unchanged)다. Undo를 다시 되돌리는 기능은 없다.
- **분류 근거.** 대상은 checkpoint 이후의 RewindFile(문서 파일)과 같은 session의 ToolCall에서 읽은 성공 앱 write(앱)다. Invocation 후행 기록이 아직 없으면 확인 불가로 표시하고 안전한 복원으로 가정하지 않는다. actor·시각 범위로 추정하지 않는다. 앱 write인데 `command.revert.supported`가 아니거나 receipt가 없으면 `remain`이다(→ lophn-agent/harness/tool-judgment).
- **남는 사실.** 질문 답·승인 결정·호출 결과·사용량·report·test result·외부 전송·activation·secret 사용은 되돌리지 않는다. 숨김 구간에 남고 `fact`로 한 줄 알린다. 소유 concern의 과거 사실을 지우거나 problem을 닫지 않는다.
- **대화 밖 상태.** rewind를 적용하면 숨김 구간에서 기다리던 질문·approval request를 취소(→ lophn-agent/questions, platform/approvals)하고, harness가 읽은 문서의 상태(읽은 hash 등)를 숨김 시작 이전 기준으로 다시 잡는다. 예약된 일은 되살리지 않는다.
- **앱 순서.** 앱 write는 원래 호출 역순이다. 같은 앱의 한 단계가 사전 검사에서 막히면 그보다 앞선 그 앱의 단계는 부르지 않는다. 다른 앱은 독립이다. 앱을 먼저, 문서 파일을 나중에 한다.
- **부분 revert.** 확인 화면에서 사람이 `remain`·`skip`을 확인해야 적용한다(요구 R7). `skip`은 파일마다 건너뛰고 그 밖의 대상을 막지 않는다. 앱 호출 시작 뒤 새 충돌은 partial로 기록하고 강제로 덮지 않는다.
- **후속 작업.** rewind는 새 agent run을 만들지 않는다. 문서 파일 복원·앱 복원·대화 숨김 결과가 서로 다르면 각 소유 기록을 분리해 유지한다.
