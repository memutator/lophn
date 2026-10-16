# approvals-app-grants

앱 grant를 S2의 모양으로 바꾼다. 범위마다 따로 승인하던 grant 표(kind 9개, grant마다 approval 하나)를 activation 한 번에 만드는 앱 grant(kind 6개)로 줄인다. 새 선언을 grant와 견줘 늘어난 부분만 뽑는 함수와, activation이 끝날 때 grant를 새 선언과의 교집합으로 맞추는 함수를 만든다. 옛 kind(`document.save`, `agent.commands`, `automation.run`)를 지운다. 앱 process의 쓰기 범위를 앱 DB 파일로 좁힌다.

- 단위: approvals (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/permissions/` (`broker/`·`adapters/` 포함. 아래 "하지 않는다"의 두 곳은 손대지 않는다)
- 읽을 것:
  - spec: S2 3·4장, 9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`. activation과의 접점은 S7 3·6장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - inventory: `I1.2#14`, `I1.2#15`, `I1.7#3`, `I1.7#8`, `I2.2#9`, `I2.2#10`, `I2.2#11`, `I2.2#12`, `I2.2#14`, `I2.2#15`, `I2.5#15`, `I2.7#6`, `I2.7#11`, `I2.7#21`, `I3.2#6` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 2.5의 B2 줄(위험 test), 3장 #3, #7
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
  - 지금 코드(읽기만): `packages/core/apps/permissions/{schema,store,commands,declarations,effective,model,flags,display,reads}.ts`, `packages/core/apps/permissions/broker/{access,apply-grant,net-fetch,secrets,problems,server}.ts`
- 계약:
  - 쓰는 것: `packages/protocol/apps/grants.ts`의 `appGrantSchema`, `packages/protocol/apps/permissions.ts`의 `appGrantScopeSchema`·`APP_GRANT_KINDS`(contract-approvals). 옛 `grantRevoke` route(그대로 쓴다), `grantsList` read. 선언 비교 값의 모양은 contract-releases-problems가 `packages/protocol/apps/releases.ts` 쪽에 고정한 "늘어난 선언·손실 단계"를 따른다.
  - 내놓는 것: `compareDeclarations(grants, declarations)`(늘어난 바깥 자원과 다른 앱 app-api 목록), `syncAppGrants(tx, app, declarations, decision)`, `Grants.appGrants(app)`용 `appGrantsOf(sql, app)`. 앞의 둘은 releases-problems의 activation 처리가 부른다(이 task는 함수만 둔다). `appGrantsOf`는 approvals-gate의 `createGrants`가 받는다.

## 할 일

1. grant 표와 store — `schema.ts`, `store.ts` (`I2.2#8`의 구현, `I1.2#15`)
   - `grants`를 contract의 `appGrantSchema` 모양으로 다시 만든다. `kind`는 `fs.read, fs.write, net.fetch, net.listen, secret.use, app.call`뿐이다. `approval` 열과 `UNIQUE`, `created_by`, `revoked_by`를 뺀다. 같은 `(app, kind, scope)`의 active grant는 하나라는 partial unique는 남긴다. schema step 내용을 고치고 개발 DB는 지우고 새로 만든다.
   - `store.ts`: `grantFromRow`·`loadGrants`·`insertGrant`를 새 모양에 맞춘다. 다른 단위(app-calls의 runtime·control)가 `Grant` 옛 모양에 기대면 type이 깨지므로, 옛 이름을 바꾸지 않고 `appGrantsOf(sql, app)` 등 새 함수를 옆에 더한다. 깨지는 것은 보고한다.
   - `activationInProgress`(`I1.7#3`)는 지운다. activation은 앱마다 줄에 서고(S7 11장 4) grant는 activation 성공 단계에서 맞춘다. `core/apps/control.ts`(app-calls)의 사용처는 그 단위가 지운다. 쓰는 곳이 남았으면 export를 남기고 보고한다.
2. 선언 비교와 grant 맞추기 — `declarations.ts`, `commands.ts` (`I2.2#9`, `I3.2#6`, `I2.7#6`, `I2.7#11`, S2 4장)
   - `declarations.ts`: `AutomationDeclarationFact`와 문서·problem code 선언을 뺀다. 남기는 것은 바깥 자원 요구(`fs`, `net`, `secret`)와 다른 앱 app-api(`app.call`) 선언이다(`declarationsOfBlueprint`의 permission 부분, `I2.7#6`).
   - `compareDeclarations(grants, declarations)`: 새 선언에서 현재 active grant가 덮지 않는 항목만 뽑는다. app-api가 늘어나는 것(자기 앱 app-api)은 묻지 않으므로 뽑지 않는다. 선언이 그대로면 빈 목록이다. 이 목록이 Gate의 `activation` 판정과 카드의 "늘어난 선언"이 된다.
   - `syncAppGrants(tx, app, declarations, decision)`: activation 성공 단계에서 한 tx로 부른다. ① 선언이 넓어지지 않았으면(비교 결과 빔) 새 grant를 만들지 않는다. ② 넓어졌으면 `decision`이 허락일 때만 늘어난 항목에 대한 grant를 만든다(허락 없이는 만들지 않는다). ③ 새 선언이 더는 요구하지 않는 active grant는 거둔다(앱 grant는 새 선언과의 교집합, req-0860). 만든 grant에는 허락한 approval 열이 없다. 이 함수는 Gate나 request를 모르고 `decision`(`granted` | `not_needed`) 값만 받는다.
   - `commands.ts`: `grant.create`는 사람이 approval과 함께 만드는 command가 아니라 위 `syncAppGrants` 안의 쓰기로 바꾼다. `checkApproval`·`GRANT_APPROVAL_CONCERN`을 지운다. grant revoke(`grantRevoke`, 사람 결정, `termination_confirmed` 순서)는 그대로 둔다. 새 호출부터 막고 이전 process 종료를 확인한 뒤 새 범위로 다시 시작하는 순서(`broker/apply-grant.ts`)도 그대로다(`I2.2#10`). route의 `confirmation: "required"` 선언은 지금 그대로다. handler의 handle 확인 부분도 건드리지 않는다. lead가 선언을 걷기로 하면(contract-approvals 보고의 계약 바꾸기 요청) 그때 handler의 확인 소비 호출만 지운다.
   - `grant.revoke_automation`과 automation 관련 command를 지운다(`I1.2#14`와 같은 정리).
3. 옛 kind와 요구 해석 — `model.ts`, `effective.ts`, `display.ts`, `reads.ts` (`I2.2#11`, `I2.2#12`, `I1.2#14`, `I2.2#13`의 쓰임)
   - `document.save`, `agent.commands`, `automation.run`을 모든 곳에서 뺀다: `model.ts`의 `resolveRequirement`(`document.save` 분기), `effective.ts`의 `AutomationEntry`와 document·agent.commands 항목, `commands.ts`의 `checkDeclared`·`normalized`, `reads.ts`. 보호 경로·realpath 검사는 앱 grant 해석으로 그대로 쓴다(`protected-paths.ts`, `adapters/realpath.ts`).
   - `agent.commands`는 agent grant(`kind: "app"` entry)로 바뀐다. 이 kind를 쓰던 다른 단위의 file은 이 task가 고치지 않는다: `core/apps/runtime/connect.ts`(app-calls), `core/lophn-agent/tools/app-toolkit.ts`(agent-tools), `core/lophn-agent/run-loop/scope.ts`(router). 보고에 file과 줄로 적는다.
   - `display.ts`: `buildGrantDisplay`는 activation 카드가 "늘어난 선언"을 보일 때 쓰도록 `compareDeclarations`의 결과를 받는 입력으로 바꾼다(`GrantDisplay`의 요구 항목과 조합 경고). 새 입력이 필요한 칸은 contract-releases-problems의 선언 비교 값을 따른다.
4. 앱 process의 쓰기 범위 — `flags.ts` (`I2.7#21`, `I2.2#14`)
   - `appFlags`의 `--allow-write`를 앱 data 폴더 전체(`app.data`)에서 앱 DB 파일과 그 `-wal`·`-shm`·`-journal`로 좁힌다. `migrationFlags`의 `--allow-write=${app.data}`도 같은 범위다(복구본·changeset 파일은 core가 쓴다). 앱 grant에서 flag를 계산하는 부분은 유지한다.
   - `pairSocketFlags`와 쌍 socket 관련은 건드리지 않는다(앱 직접 통로는 S5가 정리한다. app-calls 몫).
5. broker — `broker/` (`I1.7#8`, `I2.2#15`, `I2.5#15`)
   - 판정 근거가 "선언 ∩ 앱 grant"인 `net-fetch.ts`, `secrets.ts`, `server.ts`, `invocations.ts`, `access.ts`는 그대로 둔다. 이 길이 S5의 core 호출 경로로 합쳐지고 Gate를 부르는 연결로 바뀌는 일은 app-calls가 한다. `core/approvals`의 Gate와 이 broker의 비교 규칙이 복제되지만 code-map상 `core/approvals`는 `core/apps/permissions`를 import하지 못해서 지금은 그대로 둔다. 규칙이 서로 어긋나 보이면 보고한다.
   - `problems.ts`의 "선언한 code만 보고" guard를 뺀다. 보고 접수 자체는 남는다(`I1.7#8`). `core/problems/tests/work/broker.ts`의 선언 code guard는 releases-problems가 지운다(보고에 적는다).
   - `secrets.ts`(`I2.5#15`): `secret.use`의 요청 모양(`use({name, destination})`이 알림만 싣는지)은 제품 요구 확인이 필요해서 이 task는 바꾸지 않는다. SDK 쪽은 app-calls의 `sdk/cap-secret`이다. 보고의 "정한 것"에 이대로 남긴다고 적는다.
   - 이미 wave 1이 지우지 않은 `broker/automations.ts`, `broker/documents.ts`, `adapters/documents-save.ts`와 `mod.ts`의 그 export는 지운다.
6. 하지 않는다(다른 단위 몫)
   - `broker/apps-confirm.ts`, `broker/apps-connect.ts`: 앱 쌍 허락과 직접 통로. S5가 지운다(app-calls). 소유 path는 approvals이지만 이 task는 건드리지 않는다.
   - `releases/facts.ts`·`releases/store.ts`·`releases/commands.ts`(`completeActivation`)가 `compareDeclarations`·`syncAppGrants`를 부르는 연결: releases-problems.
7. 위험 test
   - `packages/core/apps/permissions/app-grants_test.ts` 하나, 이름은 "넓어진 선언은 사람이 허락하기 전에 앱 grant가 되지 않는다". 임시 SQLite에 앱과 active grant 하나를 만들고: ① 선언이 같으면 `compareDeclarations`가 빈 목록이고 `syncAppGrants(..., "not_needed")`가 grant를 바꾸지 않는다. ② 선언이 새 host를 더하면 목록에 그 host가 있고, `decision`이 `not_needed`일 때(허락 없이) `syncAppGrants`가 새 grant 행을 만들지 않는다. ③ `granted`면 만든다. ④ 선언에서 빠진 항목의 grant는 거둔다. ⑤ 거둔 grant 행은 다시 active가 되지 않는다.
   - `packages/core/apps/permissions/flags_test.ts` 하나, 이름은 "앱 process는 자기 DB 파일 밖에 쓰지 못한다". `appFlags`의 `--allow-write` 값이 DB 파일과 `-wal`·`-shm`·`-journal`뿐인지 본다(순수 함수, 표 한 번).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "넓어진 선언은 사람이 허락하기 전에 앱 grant가 되지 않는다", "앱 process는 자기 DB 파일 밖에 쓰지 못한다"
- 남지 않음: `grep -rn "document.save\|automation.run\|agent.commands" packages/core/apps/permissions`가 0줄이다. `grep -n "approval" packages/core/apps/permissions/schema.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음 (`createGrantCommands`·`createGrantsReads`는 `core/apps/register.ts`가 부른다. 모양이 바뀌면 app-calls가 맞춘다고 적는다)
- 안 쓰게 된 export: `GRANT_APPROVAL_CONCERN`, `checkApproval`, `activationInProgress`(남이 쓰면 남긴다), `AutomationDeclarationFact`, `automationGrantRevoke`(`protocol/apps/grants.ts`), `protocol/apps/permissions.ts`의 `document.save`·`agent.commands`·`automation.run` kind와 scope
- 정한 것: `syncAppGrants`는 request나 Gate를 모르고 `decision` 값만 받는다. `secret.use` 요청 모양은 바꾸지 않는다.
- 계약 바꾸기 요청(wave 3): `protocol/apps/grants.ts`의 옛 `grantSchema`·`grantCreate`를 지우는 시점(사용처가 app-calls에 있다)
- 넘길 줄: `I2.7#6`·`I2.7#11`의 releases 쪽(`facts.ts`, `store.ts`, `completeActivation`) → releases-problems. `I1.7#8`의 `core/problems/tests/work/broker.ts` → releases-problems. `I1.2#14`의 `runtime/connect.ts` → app-calls, `app-toolkit.ts` → agent-tools, `run-loop/scope.ts` → router. `I2.5#15`의 SDK 쪽 → app-calls
