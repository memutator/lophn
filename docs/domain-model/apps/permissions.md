---
type: domain-model
concerns: [apps/permissions]
---
# apps/permissions

Grant와 permission scope, sandbox와 secret 사용 검사를 정의한다.

## Grant (`grt`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `grt` ID | 아니오 | PK | 부여 ID |
| `app` | `app` ID | 아니오 | → apps/registration | 대상 앱 |
| `kind` | permission 종류 | 아니오 | PermissionScope의 kind와 일치 | 부여 종류 |
| `scope` | PermissionScope | 아니오 | 아래 정규 scope | 사람에게 허락받은 범위 |
| `approval` | `apr` ID | 아니오 | → platform/approvals; 정확한 app·kind·scope; 한 번 적용 | 사람 결정 |
| `status` | `active` / `revoked` | 아니오 | 최초 active | 부여 상태 |
| `created_by` | actor | 아니오 | approval의 user 결정자 → platform/identity | 허락한 사람 |
| `created_at` | UTC 시각 | 아니오 | GrantCreated event 시각 | 허락 시각 |
| `revoked_by` | actor | 예 | revoked에 필수; user | 회수한 사람 |
| `revoked_at` | UTC 시각 | 예 | revoked에 필수; GrantRevoked event 시각 | 종료 확인 뒤 회수 시각 |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | 현재 선언과 교집합을 계산할 부여 |
| `revoked` | 종료 확인 뒤 회수됨 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `active` | machine | 보호 화면의 정확한 approval; 앱에 activation 없음 | `GrantCreated` |
| `active` | `revoked` | user | 보호 화면 결정; 기존 프로세스 종료 확인 또는 이미 멈춤; activation 없음 | `GrantRevoked` |

### 불변 조건

- 부여는 blueprint 선언과 별개다. 요구의 reason을 Grant에 복제하지 않는다.
- 실행 범위 = 현재 release 요구 ∩ 현재 active Grant. app.call의 요구는 app_connections이고 agent.commands의 요구 상한은 commands 목록이다. 요구하지 않는 옛 grant는 사용할 수 없다. 같은 범위의 후속 release는 기존 grant를 쓸 수 있다.
- revoked를 다시 active로 만들지 않는다. 새 approval·새 Grant를 만든다.
- grant 변경은 기존 프로세스 종료·새 권한으로 시작하는 경계다. 실행 중 동적 권한 확대는 없다. 종료 확인 없는 회수 완료는 금지다(→ apps/runtime).

## PermissionScope (값)

kind별 아래 구조 중 하나만 허용한다. unknown field는 거절한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `path` | 절대 경로 문자열 | 아니오(fs) | 실제 경로 정규화; 보호 경로 제외; fs.read/fs.write에만 | 외부 파일·폴더 |
| `recursive` | boolean | 아니오(fs) | false=해당 대상만; true=해당 폴더 하위 | 하위 접근 범위 |
| `host` | 문자열 | 아니오(net) | 정규 DNS hostname 또는 IP; wildcard 금지; net.listen은 127.0.0.1/::1/localhost만 | 목적지/듣기 주소 |
| `port` | 정수 | 아니오(net) | 1..65535; 0·전체 port 금지 | 정확한 port |
| `name` | 문자열 | 아니오(secret.use) | secret 이름 문법 → platform/secrets | 허락할 secret 이름 |
| `key` | 문자열 | 아니오(document.save) | 같은 고정 blueprint의 documents.key | 자기 앱 place 문서 |
| `app` | `app` ID | 아니오(app.call) | → apps/registration; Grant.app과 다름 | 호출 대상 앱 |
| `commands` | 문자열[] | 아니오(app.call/agent.commands) | 비어 있지 않음; 정렬·중복/wildcard 금지; 정확한 command key | 허락 command 목록 |
| `automation` | 문자열 | 아니오(automation.run) | 현재 blueprint automatic_tasks의 key | 켜는 automation |
| `command` | 문자열 | 아니오(automation.run) | 그 automation이 부르는 command key | 고정 command |
| `input_hash` | sha256 | 아니오(automation.run) | default를 채운 정규 입력의 sha256 | 고정 입력 |
| `when` | `{kind:"on_start"}` / `{kind:"interval",interval_ms}` | 아니오(automation.run) | 현재 선언과 같음; interval_ms 60000 이상 | 켠 주기 |

Permission kind는 `fs.read`, `fs.write`, `net.fetch`, `net.listen`, `secret.use`, `document.save`, `app.call`, `agent.commands`, `automation.run`이다. fs.write는 fs.read를 암묵적으로 포함하지 않는다. 하위 범위 판정은 실제 경로와 descendant 관계이며 문자열 prefix 판정은 금지다.

## Command grant 범위 (값)

- `kind=app.call`: Grant.app은 caller, scope는 `{app:target,commands:[key...]}`다. 현재 caller blueprint.app_connections와 교집합이며 target의 현재 command 목록 안에서만 호출한다. 반대 방향과 재위임은 없다(→ apps/connections).
- `kind=agent.commands`: Grant.app은 target, scope는 `{commands:[key...]}`다. caller는 lophn agent이며 coding_agent는 포함하지 않는다. 역할별 허락을 새 grant에 복제하지 않고 역할·assignment 범위와 교집합으로 계산한다(→ lophn-agent/harness/tools).
- lophn 역할의 사람이 연 앱 command, 담당 App Engineer의 read/지원 write, Operator의 승인 read 등 역할 노출은 → lophn-agent/roles다. 앱별 허락이 그 범위를 확장하지 않는다.
- `kind=automation.run`: Grant.app은 automation을 가진 앱, scope는 `{automation,command,input_hash,when}`다. 현재 blueprint의 external automation 선언과 네 값이 정확히 같을 때만 grant.create가 받고, 선언이 바뀌면 옛 grant는 교집합에서 빠진다. 켜기는 approval로 grant.create, 끄기는 사람의 grant.revoke다. 앱 clock은 회차마다 broker에서 active grant를 확인하므로 끄는 데 프로세스 종료·재시작이 필요 없고 다음 회차부터 막힌다(→ apps/automations#R13). external이 아닌 automation은 grant 없이 앱 실행 허용을 따른다.
- 새 command key는 옛 grant에 자동 포함하지 않는다. 기존 key의 input/effect/confirm/revert 변화는 현재 blueprint와 현재 판정을 따르며 호출별 승인 대상을 바꿀 수 없다.

## SecretUseContext (값)

안전한 플랫폼 연결의 일시 값이다. secret 값·값의 hash·credential 원문은 ledger에 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | 실행 credential과 일치 → apps/registration | 사용 앱 |
| `release` | `rel` ID | 아니오 | 현재 프로세스 release → apps/releases | 선언 기준 |
| `invocation` | `inv` ID | 예 | 알려진 실제 호출 ID만; 성공 일반 read는 ledger 행이 없을 수 있음 → apps/invocations | 한 호출의 알려진 참조 |
| `command` | 문자열 | 아니오 | 현재 고정 blueprint의 검사된 command 문맥; confirm 여부는 secret 허락과 별개 | 사용 명령 |
| `input_hash` | sha256 | 아니오 | 검증·default 적용한 실제 입력; confirm이면 approval 입력과도 일치 | 정확한 입력 |
| `name` | 문자열 | 아니오 | 현재 secret 선언·active secret.use grant 모두 존재 | secret 이름 |
| `destination` | `{scheme:string,host:string,port:integer}` | 아니오 | 실제 전송 목적지; 현재 net.fetch 선언∩grant의 정확한 host·port | 전달 목적지 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Grant | 대상 | → apps/registration | 1 | 삭제 거절 |
| Grant | 결정 | → platform/approvals | 1 | 감사 참조 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `grants` | Grant; 정규 scope JSON | PK `id` | `approval`; partial unique `(app,kind,정규 scope)` WHERE status='active' | `(app,status,kind)` | app → apps; approval → platform/approvals |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `grant.create` | machine | app,kind,scope,approval | 정확한 approval·현재 요구(app.call은 app_connections, agent.commands는 commands, automation.run은 external automation 선언)·앱의 grant 집합 seq; activation 없음 | `GrantCreated` | `forbidden`, `invalid_input`, `conflict` |
| `grant.revoke` | user | grant,종료 확인 근거 | 앱의 grant 집합 seq·현재 프로세스 종료(automation.run은 제외)·activation 없음 | `GrantRevoked` | `conflict`, `unavailable` |

`grant.create`는 dispatch 전용이다. `apply_approved_action`이 approval 사용과 같은 transaction에서만 부르고, HTTP 직접 호출은 등록되지 않은 command와 같은 `invalid_input`으로 거절된다(platform Q31). `grant.revoke`는 직접 호출 command다.

grant 집합 seq는 그 앱의 grant에 마지막으로 남은 GrantCreated·GrantRevoked event의 seq(없으면 0)다. grant.create와 revoke가 같은 값으로 비교하고 activation도 시작 때 이 값을 고정한다. 종료 확인 근거는 그 앱의 마지막 프로세스 사실(AppStarted·AppStopped)로 판정한다: 한 번도 시작하지 않았거나 마지막이 AppStopped면 이미 멈춘 것이고, 마지막이 AppStarted면 입력의 process_nonce가 그 nonce와 같고 termination_confirmed가 true일 때만 revoked로 확정한다. 나머지는 unavailable이고 grant는 active로 남는다. 범위 밖 앱·없는 grant·이미 회수한 grant는 같은 `conflict`로 답한다.

secret 사용은 ledger 변경 command가 아니다. 플랫폼 전달기가 현재 선언·grant·mode를 검사하고 → platform/secrets의 전달 경계를 사용한다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `GrantCreated` | Grant | app,kind,scope,approval,created_by,created_at | apps/runtime, apps/connections, lophn-agent/harness/tools |
| `GrantRevoked` | Grant | app,kind,revoked_by,revoked_at | apps/runtime, apps/connections, lophn-agent/harness/tools |

## 정책

- **기본 권한.** 자기 bundle 읽기·자기 DB 읽기/쓰기·자기 소켓·필수 플랫폼 통로만 있다. 외부 파일·network·secret·document.save는 0에서 시작한다.
- **금지 범위.** 다른 앱 DB/source·플랫폼 보호 경로·keychain·credential 파일을 포함한 넓은 부모 경로도 거절한다. 모든 host·홈 전체 편의 grant는 없다.
- **sandbox.** Deno `--no-prompt`; `--allow-all`, `--allow-run`, `--allow-ffi`, `--allow-sys`, `--allow-env`는 금지다. runtime 원격 import·의존 다운로드·임의 설정·하위 프로세스·native code는 금지이며 migration에도 적용한다.
- **강제.** fs/network scope 교집합만 실행 권한으로 번역한다. 표현할 수 없는 network 방향 정책은 거절한다. SDK는 같은 앱 코드와 같은 프로세스이며 별도 보안 경계가 아니다.
- **secret.** 시작 준비 코드·준비 모드·preview에는 운영 secret 문맥이 없다. 운영 앱의 검사된 command는 선언 이름∩유효 grant의 secret을 쓰고 호출마다 사람 확인을 받지 않는다. automation·agent·다른 앱이 부른 command도 같은 grant로 쓴다. 실제 전송은 net.fetch 선언∩grant의 host·port도 검사한다. 값 보관·이름 변경 event는 → platform/secrets.
- **전달.** argv·환경 변수·화면·agent 응답·invocation·event·공통 blob에 secret 값을 넣지 않는다. redaction 등록 실패면 전달하지 않는다. destination 변경 redirect는 재검사한다.
- **회수.** secret 교체·삭제는 사용 앱을 재시작한다. 이미 일어난 업무 쓰기·외부 요청의 취소를 뜻하지 않는다.
- **조합 검사.** fs.read와 net.fetch 동시 요구는 외부 전송 조합 경고 대상이며 grant 자체를 자동 허락하지 않는다.
- **grant 표시 자료.** `grants.list`는 앱을 지정하면 현재 release 선언을 아는 경우에 한해 `display`를 함께 낸다: 요구별 kind·정규 scope·reason·granted(같은 정규 scope의 active grant 유무)·경고 key, 조합 경고, Deno 한계 문구 key(`permissions.limit.*`). 선언을 모르면 null이다. read는 파일 I/O를 하지 않으므로 폴더 밖 link 검사는 부여 준비가 한다.

- **command 허락.** app.call·agent.commands는 기본 0이다. Deno flag가 아니라 서명된 AppConnection의 명령 범위로 강제한다. app.call은 필요한 target direct socket만 source에 추가한다. 연결 준비 뒤 요청/응답은 직접 전송한다.
- **관련 프로세스.** app.call 변경/회수는 source 자식 종료 확인 뒤 적용한다. target의 release/command/permission 경계 교체도 관련 source 연결을 닫고 source 자식을 새 연결 범위로 재시작한다. agent.commands 변경/회수는 target 자식 종료 확인 뒤 새 nonce로 적용한다. 다른 app.call/agent 연결도 옛 nonce를 쓸 수 없다. 종료 미확인은 회수 진행 중이다.

## 정할 것

- network 방향을 Deno 밖 OS 제한/플랫폼 전송부로 나누는 정책을 → platform/security와 정한다. 넓은 플래그로 조용히 우회하지 않는다.
- secret 원값은 앱 코드에 주지 않고 플랫폼 전송부에서 붙인다(apps#I7). 인증 부착 방식별 요청 schema는 spec에서 정하며 일반 원값 조회는 만들지 않는다.
- automation의 external 명령은 사람이 automation을 켤 때 command·고정 입력·주기를 한 번 승인한 범위에서만 실행한다(→ apps/automations). confirm=true 명령은 automation에서 뺀다.
