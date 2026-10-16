# places-sessions-rewind

session rewind를 새 설계로 맞춘다. 대화와 그 session이 file tool로 바꾼 파일을 되돌리는 것은 그대로 두고, 옛 앱 단계(앱이 선언한 되돌림 command를 부르던 것)를 지우고, 사람이 고른 시점 뒤에 이 session이 앱에 한 write를 앱마다 보여 고른 앱만 core의 앱 rewind(S5)에 넘기는 길을 잇는다.

- 단위: places-sessions (wave 3)
- 선행: places-sessions-session (`sessions` 표의 새 열과 `acceptsInput`), router-run-loop-input (`turns` 표 이름)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/rewind/` 전체
- 읽을 것:
  - spec: S8 4장(session rewind와 앱 rewind 잇기, checkpoint) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S5 7·8장(앱 rewind의 순서, session rewind와 나누기) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S4 3장(file tool의 범위, shell이 바꾼 파일은 되돌리지 않는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S2 6장(session이 끝나면 대기 권한 요청은 cancelled) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `I2.2#21`, `I2.8#8`, `I2.8#9`, `I3.8#9`
  - 요구: req-0044(rewind가 되돌리는 파일), req-1519(session rewind와 앱 rewind 잇기) — `/home/pyosechang/projects/lophn/project-docs/requirements/core-lophn-agent.yaml`
  - 결정: `../README.md` 3장 #5(file tool은 agent runtime, place 폴더)
  - 지금 코드: `session/rewind/{preview,commands,app-commands,app-steps,app-revert,effects,files,record,judge,root,prepare,restore}.ts`
- 계약:
  - 쓰는 것: `protocol/lophn-agent/session-rewinds.ts`(`sessionRewindInputSchema`, `sessionRewindCompareSchema`, `sessionRewindPreviewOutputSchema`, `sessionRewind`, `sessionRewindPreview`), `core/lophn-agent/ports.ts`(`AppWrites`, `ProjectDirectory`, `AppDirectory`, `SessionEndEffects`), contract-app-calls가 정한 앱 rewind 요청·계획·결과(`protocol/apps`), `core/apps/ports.ts`(앱 rewind를 부르는 port. 이름은 그 file을 본다)
  - 내놓는 것: file tool이 쓰기 직전에 부르는 `recordBeforeWrite`(모양 그대로 유지, 부르는 배선은 agent-tools 몫), `createSessionRewindCommands(deps)`, `createSessionRewindReads(deps)`

## 할 일

1. 앱 단계 지우기(`I2.8#8`): `app-steps.ts`, `app-revert.ts`(앱 revert binding·분류), `app-commands.ts`(`hasAppSteps`, `startApplying`, `createAppStepCommands`)와 `commands.ts`·`preview.ts`·`settle.ts`·`reads.ts`·`schema.ts`·`store.ts`·`recover.ts`·`reconcile.ts`에 걸린 앱 단계(`appRevertBinding`, `appStepResult`, `runAppRevert`, `RevertItem`의 `app` class, `applying` 중 앱 단계 대기)를 걷어낸다. 앱 data는 session rewind가 저절로 되돌리지 않는다(S5 8장). `undo`·`redo`(`undoEdit`, `redo`)도 새 계약에 없으므로 걷어낸다(contract-calls-places-places가 정한 것).
2. 앱 고르기를 잇는다(`I2.8#8`, `I3.8#9`):
   - preview(`PreviewRewind`)는 고른 checkpoint 뒤에 이 session이 한 write invocation을 `AppWrites.writesAfter(session, checkpointSeq)`로 받아 `app_writes`(앱마다 invocation 목록)에 싣는다. 앱 rewind의 계획(함께 되돌아갈 다른 변경, 되돌아가지 않는 external 효과, 되돌릴 수 없는 write)은 앱 rewind의 계획 route가 주는 것을 그대로 보인다. 여기서 만들지 않는다.
   - `Rewind` 입력의 `apps`(사람이 고른 앱)가 비면 앱 data는 그대로이다. 있으면 파일 복원과 대화 되돌리기가 끝난 뒤 그 앱마다 앱 rewind를 "이 session의 첫 write invocation 직전"으로 요청한다. 앱 rewind는 앱 쪽의 순서(drain, 충돌 시 통째로 취소)를 따르므로 이 command는 요청한 결과(접수, 적용, 거절)를 기록에 남기고 앱 rewind의 성공을 기다려 세션 되돌림을 취소하지 않는다. 대화와 파일은 먼저 끝나고 앱은 따로 끝난다.
   - 확인은 대화 화면 안의 panel에서 받는다. `confirmation: "required"`와 `binding`·`display_read`는 두지 않는다(새 계약 `sessionRewind`에 없다).
3. checkpoint (S8 4장): turn을 시작하는 Router 입력(사람 메시지, call, 답)마다 생긴다. steer로 도는 turn에 들어간 메시지는 checkpoint가 아니다. `checkpoints.ts`의 `mode: "request" | "correction" | null`을 `delivery: "next_turn" | "steer" | null`과 `from_kind`로 바꾸고, `correction·agent·machine 메시지와 Fork 복사본에는 checkpoint가 없다`는 규칙을 "steer 메시지와 Fork 복사본에는 없고, turn을 시작한 사람 메시지·call·답에는 있다"로 바꾼다. `schema.ts`·`preview.ts`의 `correction` 주석과 문구도 steer로 바꾼다.
4. 되돌리는 파일의 범위 (`I2.8#9`): file tool(write, edit)이 바꾼 파일만 되돌린다. shell이 바꾼 파일은 제외한다(S4 3장). pre-image 기록은 `record.ts`의 `recordBeforeWrite`이다. 문서 tool이 쓴 파일이라는 옛 전제(문서 판, 문서 ID)가 `record.ts`, `files.ts`, `judge.ts`, `root.ts`, `prepare.ts`, `restore.ts`에 있으면 파일 경로 기준으로 바꾼다. `projectRootOf`는 place 폴더를 `ProjectDirectory`·`AppDirectory`로 얻는다(project는 등록 폴더, 앱은 source 폴더, lophn은 읽기만 하므로 pre-image가 없다). 쓰기 직전 `recordBeforeWrite`를 부르는 배선은 agent-tools(`I3.8#8`)가 한다. 이 task는 함수의 입력을 `(session, turn, path)` 기준으로 안정시키고 모양을 보고에 적는다.
5. 대기 요청 취소 (`I2.2#21`): `effects.ts`가 `approval_requests` 표를 run으로 조인해 `cancelApprovalRequest`를 부르던 것을 없앤다. rewind가 session의 대기 권한 요청을 취소하는 길은 `SessionEndEffects.cancelPendingRequests`가 아니라 rewind 자체의 효과이므로, `core/lophn-agent/ports.ts`에 같은 이름으로 선언된 port가 있으면 쓰고 없으면 "계약 바꾸기 요청"에 적는다. 보류 request(`approval_requests`)는 session에 묶이지 않는다(S2 6장). 취소 대상은 session snapshot의 대기 권한 요청과 질문뿐이다.
6. `run` 이름을 `turn`으로 바꾼다(`active_run` → `active_turn`, 주석 포함).
7. test: `rewind_test.ts` 한 파일, 가벼운 준비로 표를 돈다.
   - "고른 시점 뒤에 이 session이 file tool로 바꾼 파일만 되돌아가고 shell이 바꾼 파일은 그대로다"
   - "apps를 고르지 않으면 앱 rewind를 요청하지 않는다"

- (lead가 더함, fix-turns가 넘긴 것) `session/rewind/{commands,app-revert,preview}.ts`가 아직 없는 `runs` 표를 `join runs r on r.id = t.turn`으로 읽는다. 다시 지을 때 `turns`로 바꾼다. `model_calls`·`tool_calls`의 열은 이제 `turn`이다.

- (lead가 더함, app-calls-assembly가 넘긴 것) apps가 `ctx.appRewind`(`AppRewind`)와 `ctx.invocationLedger`를 wiring slot으로 낸다. 옛 `core/apps/revert/`와 `wiring/apps-revert.ts`는 지운 `apps/connect`를 불러 실패한다. 새 rewind로 바꿔 끼우며 지운다(`server/credentials.ts`·`main/worker/main.ts`의 import 줄 포함, 추가 소유 lead 승인).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "rewind가 이 session이 file tool로 바꾼 파일만 되돌린다", "apps를 고르지 않으면 앱 data는 그대로다"
- 남지 않음: `grep -rn "appRevert\|AppRevertBinding\|runAppRevert\|undoEdit\|redo\b\|correction\|active_run" packages/core/lophn-agent/session/rewind`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/registry.ts`에서 옛 `REVERT_ROUTES`(undo, redo, 앱 단계 포함)를 `sessionRewind`·`sessionRewindPreview`·checkpoint 목록·rewind 목록 read로 바꾼다. core 조립 목록의 `createRevertCommands`
- 안 쓰게 된 export: `protocol/lophn-agent/reverts.ts` 전체(`rewindInputSchema`, `undoEdit`, `redo`, 앱 단계 type), `session/rewind/mod.ts`의 옛 export
- 정한 것: 앱 rewind 요청의 시점(이 session의 첫 write invocation 직전), 앱 rewind 결과를 기다리지 않는 것, `recordBeforeWrite` 입력 모양
- 계약 바꾸기 요청(wave 3): `AppWrites`나 앱 rewind port에 모자란 것, 대기 요청 취소 port

- (lead가 더함, agent-tools-file이 넘긴 것) file tool이 `recordBeforeWrite`에 넘기는 path는 맞는 허용 폴더 기준 상대 경로(`Resolved.relative`)다. 허용 폴더가 여럿(PM의 project 폴더와 context 폴더)이면 `RecorderPorts.read(path)`가 어느 폴더에 붙일지 알 수 없다. 기록에 root를 같이 싣는 쪽(추천)으로 맞춘다.
- (lead가 더함, agent-definition-register가 넘긴 것. 추가 소유, lead 승인: rewind pre-image 기록 route 계약과 runtime의 `rewind` tool port 줄) runtime child의 tool port `rewind`가 닫혀 있다. 쓰기 전 pre-image를 core에 남기는 memory route(actor agent, session·turn 일치 검사)를 만들고 runtime port(`main/agent-runtime/product-driver.ts`의 `rewind` 줄)를 그 route로 채운다. 새 route는 보고에 적는다(lead가 registry에 올린다).
