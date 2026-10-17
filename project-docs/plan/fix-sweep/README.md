# fix-sweep

- 목표: e2e-coverage 계획과 그 마무리가 남긴 열린 이슈 넷을 고치고 0.2.0 판을 닫는다.
- 재료: `project-docs/issues/approval.md`("Grants 화면에서 agent 부르기를 빼도 core는 그 call을 허락한다"), `project-docs/issues/platform.md`("stack 없는 앱 crash가 crash마다 새 문제와 새 App Engineer session을 연다"), `project-docs/issues/agent-definition.md`("목록에서 빠진 tool의 이유 구별(grant·release·거절)이 run-loop에서 닿지 않는다"), `project-docs/issues/agent-call.md`("가져간 call 글이 뒤 turn의 history에서 태그 없이 원문으로 들어간다")
- 범위 밖: 다른 열린 이슈(rewind 검사의 fixture 입력, docx 읽기, MCP 층, codex hook, ChatGPT model 고르기, chip, MCP 설정 통로, events 점검). 새 E2E file.
- 단위: task 하나에 단위 하나. `grants-excluded`(renderer Grants 화면), `crash-group`(problems 묶는 key), `missing-tool-reasons`(lophn-agent tools·run-loop의 죽은 이유 구별), `call-history-tag`(lophn-agent session history).
- 순서: wave 1 하나. 넷은 소유가 겹치지 않아 같이 돈다.
- 사람이 정할 것: 없음. 사람이 "작은 fix 계획으로 해결"을 지시했다. crash 묶는 key는 이슈의 추천(관측 종류·오류 이름·메시지·release)으로 간다.
- lead가 할 일: merge마다 이슈를 archived로 옮긴다. 다 끝나면 바뀐 동작을 architecture 문서에 맞추고(`approval.md`, `agent-call.md`), changelog 0.2.0에 항목을 덧붙이고, 판을 닫고(`status: released`, `released_at`), 이 폴더를 지운 commit까지 land한 뒤 tag `v0.2.0`을 달고 push한다(사람이 지시했다).

## 정한 것

1. crash 묶는 key: 앱 frame 위치를 못 푼 관측은 report id 대신 관측 종류(`observation`), 오류 이름, 메시지, bundle hash의 hash로 묶는다. `process_exit`의 메시지는 exit code나 signal을 담으니 같은 이유의 crash가 같은 release에서 한 문제가 된다. 문제는 이미 `(app, group_key)`로 찾으니 앱은 key에 넣지 않는다. (agent)
2. missing tool 이유: 지운다. 목록에 없는 tool은 `not_found` 하나다(이슈 추천). (agent)
3. history 태그: history도 입력과 같은 규칙으로 싼다(이슈 추천). (agent)
4. Grants 화면: 끄기는 `excluded` 줄, 줄 없음은 기본(부를 수 있음)이다(AGENT-ROLE T4, 사람이 앞 계획에서 `excluded`를 정함).
