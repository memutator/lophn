# 알려진 미완 동작

지금 안 되는 동작과 고치려면 필요한 것이다. lead가 worker 보고의 "알려진 미완 동작"에서 덧붙인다. 고치면 항목을 지운다.

항목 꼴: 지금 동작. 고치려면 필요한 것. (출처 task와 commit)

## 지금 안 되는 동작

- **앱 rewind.** session rewind는 파일과 대화만 되돌린다. 앱 데이터 되돌리기 요청은 wiring(`ctx.peek.appRewind`)이 비어 늘 `unavailable`로 rejected가 남는다. 고치려면: 앱 rewind 계약을 짓고 wiring을 채운다. (places-sessions-rewind `367d98e3`)
- **crash 기록.** daemon·agent runtime에 unhandled rejection listener가 없고 `createDiagnosticHost`를 만드는 곳이 없어 crash가 diagnostic log에 남지 않는다. 고치려면: 작은 fix task 하나. (platform-diagnostics `651a195f`)
- **Diagnostics 점검.** core·ledger 둘만 본다. events·앱·sandbox·agent runtime 점검은 각 wiring이 `componentChecks.push`로 더해야 한다. (platform-diagnostics)
- **md가 아닌 context 문서의 목차.** pdf·docs 개체는 늘 unreadable이다. 고치려면: `outlineSourceSchema.format`을 넓히고 context worker 요청에 저장 목차를 싣는 계약 고침 둘. (places-sessions-contexts-drafts `12027baf`)
- **제보 창의 기존 문제 고르기.** 같은 앱의 열린 문제 목록을 못 받아 늘 "새 문제"로 보낸다. Issues에서 연 제보만 기존 문제에 붙는다. 고치려면: `beginFeedback` 답을 `{draftRef, problems}`로 넓히는 계약 고침. (screens-app-space-main `629465d9`)
- **열린 PM session에 위반 chip 붙이기.** 열린 session에는 chip을 붙일 계약이 없어, 비어 있는 draft에 위반 줄을 글로 채운다. 새 PM 탭은 chip이 붙는다. (fix-workspace-route `df1e536d`)
- **PM이 초안 폴더를 연 같은 turn의 쓰기.** `context.draft`로 연 폴더가 그 turn의 file 범위에 아직 없어 `file.write`가 forbidden이다. 다음 turn부터 된다. (places-sessions-contexts-drafts)
- **화면이 여럿인 앱의 annotation 위치.** release map을 화면별로 합치지 못해 source 위치가 안 풀린다. 화면 하나인 앱은 된다. (fix-app-build `3ad9a6ef`)
- **Router `describe`의 `waiting`.** 기다림은 main thread 메모리에 있고 describe는 reader Worker에서 돌아 running/idle만 낸다. (router-waiting `a9a6a206`)
- **project 검색의 접근 권한.** apiRead가 port를 못 받아 project 접근 권한을 보지 않는다. user만 부르는 route다. (places-sessions-search `3f0c247b`)
- **write app-api의 rewind 검사.** fixture 입력으로 앞선 상태를 못 만드는 write app-api는 fail로 나와 release 준비가 막힐 수 있다. 실제로 막히면 앱이 fixture를 주는 방식을 정한다. (fix-rewind-check `7290b61a`)
- **coding 완료 뒤 harness.** 완료 보고 뒤 core가 harness를 멈추지 않는다. 추천: 첫 prompt에 "보고 뒤 종료"를 넣는다. harness 권한 물음은 `mcp_tool` intent를 빌려 담는다. (coding-agent-session `e5c029ad`)
- **`harness install` 결과.** core에 알리지 않는다(`codingTerminalResult`에 칸이 없다). (coding-agent-terminal `1ae03dbb`)
- **외부 MCP tool 이름.** 읽는 route가 없어 Grants의 "Tools from MCP servers"가 빈다. (agent-definition-extensions `4da65e2d`)
- **파일 읽기 형식.** pdf는 `unpdf`로 읽고 docx 같은 형식은 읽지 않는다. (agent-tools-file)
- **새 session 첫 말의 context chip.** core source가 무시한다(`attached: []`). 화면은 chip을 첫 글감으로만 쓴다. (screens-conversation-view `be54a797`)
- **앱 바로가기.** 위쪽 바에서 뺐고 옮길 곳은 정하지 않았다(추천: Settings나 Apps 화면). (screens-app-space-frame `8c5d5790`)
- **`AgentCallRecord.options`.** 앱 줄에 선 coding 맡기기의 옵션은 transport 메모리에만 있다. (router-calls)

- **큰 앱 호출 changeset.** 상한은 호출당 8MiB인데 changeset이 base64로 supervisor control frame(256KiB, `CONTROL_MAX_BYTES`)을 지난다. 약 190KiB를 넘으면 write는 일어났는데 "결과 모름, changeset 없음"으로 닫혀 rewind가 막힌다. 고치려면: changeset을 frame 밖(blob, 파일)으로 넘기거나 상한을 frame에 맞춘다. (`core/apps/calls`, `supervision/relay.ts`)
- **annotation screenshot이 App Engineer model에 안 간다.** `annotationDelivery.deliver`가 `images`를 받고 쓰지 않아 메시지에는 `[image: ...]` 줄만 있다. App Engineer에는 이미지를 열 tool도 없다. coding agent는 `ticket show`의 파일 경로로 받는다. 의도인지 정한다. (`core/main/daemon/wiring/router.ts`)
- **OpenCode 맡기기.** adapter가 `hook: null`인데 turn 끝 신호 표에는 `session.status idle`이 있어 메시지를 받을 수 있는 것으로 나온다. hook이 설치되지 않아 상태가 늘 unknown이고 메시지는 `state_unknown`으로 거절된다. (`protocol/coding-agent/harness-adapter.ts`)
- **session 되살리기.** protocol에 `unarchiveSession` route가 있는데 core handler가 없다.
- **앱 place의 Operator file 범위.** `run-loop/place-data.ts`에 앱 place의 Operator 폴더 처리가 없어 file 범위가 없다.

## 그대로 두기로 한 규칙

- **settings 파일이 시작 때 거절되면** 기본값으로 시작하고 다음 update가 그 파일을 덮는다. 손으로 고친 틀린 파일이 덮일 수 있다. (platform-config `71626c21`)
- **`release.prepare_bundle`의 `ticket_source`.** 계약은 optional인데 core가 필수로 막는다. cleanup 때 계약을 필수로 맞춘다. (releases-problems-bundle `293e0d88`)
