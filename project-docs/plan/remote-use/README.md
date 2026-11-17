# remote-use

상태: README만 열었다. task 문서는 `device-roster`와 `core-terminals`가 main에 올라간 뒤에 쓴다.

- 목표: agent와 앱이 다른 기계의 것을 쓰고 구독한다. 내 PC의 agent가 VM의 앱 command를 부르고, 그 앱의 event를 받아 반응한다. workspace의 private 설정이 기계 사이에도 선다.
- 재료: `project-docs/products/roadmap/multi-device.md`("주고받는 것 네 가지"의 remote와 event, "해도 되나"), `project-docs/architecture/agent-call.md`(call 정책, private), `app-call.md`, `approval.md`, `event.md`, 조사 `reports/multi-device/survey-s6-remote-events-sync.md`(1c, 1d, G3·G7·G8), `survey-s1-address.md`(1.8)
- 기대는 것: `device-roster`(다른 기계를 부르는 길), `core-terminals`(다른 기계의 터미널과 coding session), 순서 1(가리키는 법)
- 범위 밖: a2a(다른 기계의 agent에게 일을 맡기기, handoff), 꺼진 기계의 것을 쓰기, 사람의 화면이 다른 기계를 보는 것(`one-screen`)

## 정한 것

- **대상은 정해진 동작을 가진 것이다.** 앱의 command, 앱의 event, job, file, 터미널, browser page. 다른 기계의 agent에게 판단을 맡기는 것은 a2a이고 이 계획이 아니다. (사람: remote와 a2a를 나눴다)
- **"어느 기계"는 붙이는 것 하나다.** CLI와 agent의 tool에 기계를 고르는 인자 하나가 붙는다(`lophn <앱> <command> --machine <이름>`). 안 붙이면 지금처럼 이 기계다. 이름은 명단의 기계 이름이다. (agent)
- **허락은 지금의 approval 그대로다.** 요청한 쪽의 이름에 "어느 기계의"가 붙는다. agent가 다른 기계의 앱을 쓰는 것은 그 앱의 할당이 정하고, 물을 것은 같은 승인 card로 묻고, card는 사람이 지금 있는 기기로 간다. (사람: "기존의 approval이랑 크게 다를 게 없을 거 같은데")
- **받는 기계가 가린다.** 넘어온 call에는 부른 주체(어느 기계의 어느 agent나 앱)가 실리고, 받는 기계가 자기 할당과 call 정책으로 가린다. 부른 기계의 말을 그대로 믿지 않는다. (agent)
- **구독하는 주체가 있다.** agent와 앱이 다른 기계의 event를 구독한다(지금은 그 기계의 화면과 기기만 구독한다). 구독은 그 기계에 등록되고 연결이 끊겼다 붙으면 이어진다. 끊긴 동안의 것은 `carry-paths`의 길로 늦게 온다. (사람: "구독하는 주체가 있을 거 아니야")

## 사람이 정할 것

- private을 넓히는 모양. 추천: private의 뜻을 "바깥과 섞이지 않는다"로 넓혀, 바깥에 "다른 workspace"와 "다른 기계"를 둘 다 넣는다. private인 workspace의 agent와 앱은 다른 기계를 부르지 못하고 다른 기계에서도 부르지 못한다. data 맞추기는 private과 따로 둔다(같은 것을 여러 곳에 두는 것이지 섞이는 것이 아니다). 사람의 화면은 private이어도 본다.

## 계획을 열 때 정할 것

- 넘어온 call의 주체를 받는 기계의 자격으로 바꾸는 꼴(지금 기기는 모두 사람 자격이다).
- 다른 기계의 앱이 내 기계에 없을 때 agent가 그 앱의 command 목록을 아는 길.

## lead가 할 일

- 계획을 열 때 지금 code를 다시 조사한다.
- 권한 경계를 바꾸는 계획이다. 계약 task 뒤에 다른 worker의 review를 거친다.
