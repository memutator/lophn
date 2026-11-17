# one-screen

상태: README만 열었다. task 문서는 `device-roster`, `core-terminals`, `core-browser`가 main에 올라간 뒤에 쓴다(고칠 file이 그때 달라진다).

- 목표: 사람이 지금 앉은 기계나 폰의 화면 하나에서 내 모든 기계의 것을 본다. 다른 기계의 대화, coding agent, 터미널, 앱 화면, agent의 browser page가 내 것과 같은 목록에 기계 꼬리표를 달고 보이고, 그 자리에서 열어 이어서 시킨다.
- 재료: `project-docs/products/roadmap/multi-device.md`("어떻게 보이나", "가리키는 법"), `project-docs/architecture/remote.md`("desktop에서 다른 기계 보기"), `project-identity.md`("다른 기계의 창"), `workspace-layout.md`, `phone-screen.md`, 조사 `reports/multi-device/survey-s6-remote-events-sync.md`(1b, G4·G5), `survey-s4-setup-tabs.md`(G9)
- 기대는 것: `device-roster`(core가 다른 컴퓨터에 붙어 있고 `machines/call`로 부른다), `core-terminals`(터미널과 coding session이 core의 route다), `core-browser`(page를 멀리서 본다)
- 범위 밖: agent와 앱이 다른 기계를 부르기(`remote-use`), session의 기록을 맞추기(하지 않는다), 여러 기계의 Home을 하나로 합치기(하지 않는다), 다른 기계의 file editor

## 정한 것

- **기계 하나에 창 하나를 없앤다.** 지금은 다른 기계가 따로 창이고 그 창에서는 탭 종류 16가지 가운데 11가지가 막혀 있다. 한 창의 목록에 모든 기계의 것이 섞이고 줄마다 기계 꼬리표가 붙는다. (사람: "내 머신에서도 보고 싶으니까 remote를 하는 게 아니겠어")
- **같은 project는 한 묶음이다.** 정체(`pri_`)가 같은 project는 기계가 달라도 한 project 아래에 모이고, 그 안의 session과 터미널에 기계 꼬리표가 붙는다. Home은 기계마다 따로 보인다. (사람: "home도 따로 두는 게 맞을 듯")
- **화면은 "어느 기계"를 고르는 층 하나를 거친다.** 화면이 core를 읽는 모양(`CoreSource`)은 그대로 두고 그 앞에서 기계를 고른다. 기계가 꺼져 있으면 그 기계의 줄은 꺼짐으로 보이고 나머지는 그대로다. (agent)
- **열리는 것.** 다른 기계의 대화, coding agent(GUI와 터미널), 터미널, 앱 화면, agent의 browser page. 앱 화면은 그 기계의 core가 주는 화면 file을 받아 그린다. (사람의 roadmap)
- **폰도 같다.** 폰의 목록 하나에 모든 컴퓨터의 session이 보인다. 지금의 "컴퓨터 고르기"는 꼬리표와 거르기가 된다. (agent)
- **권한은 받는 기계가 본다.** 기기의 범위를 넘는 것은 받는 기계가 거절한다. 화면이 숨기는 것으로 막지 않는다. (agent)

## 계획을 열 때 정할 것

- 다른 기계의 앱 화면을 그리는 자리(지금 `lophn-app://`는 이 컴퓨터의 core만 본다)와 그 화면의 격리.
- layout에 다른 기계의 탭을 저장하는 꼴(기계가 꺼져 있을 때의 탭).
- 알림과 Inbox를 기계를 건너 한데 모으는 범위(`carry-paths`의 event와 맞춘다).

## lead가 할 일

- 계획을 열 때 지금 code를 다시 조사한다(앞 계획들이 화면과 route를 바꾼 뒤다).
- 화면 task는 `ui-design` skill대로 wireframe을 먼저 고친다.
