# multi-device: 한 사람의 여러 기기가 주고받는 것

상태: 로드맵. 2026-11-17 사람이 방향을 내고 planner가 정리했다. 순서 1~3은 끝났다(2026-11-18). review에서 나온 구멍은 `multi-device-fixes`가 고쳤다(끝남, 2026-11-18). 다음은 순서 4~6이다(아래 "순서와 계획"). `paths-by-environment.md`(초안)를 이 문서가 대신한다. `multi-machine.md`(끝남)가 만든 것 위에 선다. 일을 core로 옮기는 것은 `shell-as-client.md`가 따로 다룬다.
배경 문서: `project-docs/architecture/remote.md`, `machine.md`, `folder-sync.md`, `app-sync.md`, `event.md`, `approval.md`, `agent-call.md`, `project-identity.md`, `attention.md`. 조사: `reports/multi-device/`(다른 제품의 기기 들이기 `device-enrollment-survey.md`, Paseo의 터미널 `reports/phone-native-ui/paseo-terminal.md`, 두 기기가 같은 session을 다룰 때 `/tmp`에 있던 조사는 이슈 여덟으로 옮겼다, 지금 code `survey-s1`~`s6`).

## 사람의 말 (원문)

> 중심 기계를 둔다/아니다 와 간단한 문제가 아니라니까? 사용자 환경이 다 다른데 어떻게 해. 그에 맞춰서 우리가 길을 준비해놔야하는거라고. vm 없으면 file에다 google drive 붙여서 쓸 수 있게, tailscale 없으면 한계를 감안하고 우리 relay 서버, vm이 있으면 사용자의 선택의 폭이 가장 높아지는거고

> 세션 데이터 transcript 같은 건 동기화 할 필요가 없고 해서도 안 된다니까? 환경이 다른데 그걸 어떻게 옮겨, tool 이력도 다른데. 그냥 remote만 할 수 있으면 충분하다고. 근데 이제 충돌 같은 건 해결해야하는 거고. 그리고 또 해당 컴퓨터가 꺼져 있어 그러면 이제 handoff가 가능해야해. […] 이거는 multi device orchestrator 고도화에서 신경 쓸 내용이라 지금은 신경 안 써도 되는거고

> 3 알림은 너무 renderer 적인 성격이 강해, event로 보는 게 어때? 4는 지금 다룰 건 아니지만 handoff에 국한된 게 아니라서 a2a로 보는 게 맞는 거 같아

> event를 요청하는 쪽은 없어도 구독하는 주체가 있을 거 아니야. 그리고 remote로 단순히 agent session만 아니라 app을 사용하는 그런 경우도 있을 거 아니야. 예를 들어서 vm의 상태를 모니터링하는 app이 있다치면 그 결과를 내 머신의 agent가 요청한다거나

> 근데 서로 한 쪽만 켜져 있을 수 밖에 없는 경우가 있잖아. 집/직장, 듀얼 부팅이라든가. 근데 그런 경우에 늦더라도 상관 없지 않아? 애초에 될 수 있다가 중요한 거 아니야? data sync 하라는 건 event 안 내는거야?

> 근데 사실상 폰을 hub로 쓸 수도 있게 하는 선택지도 제공할 수 있는 거 아니야? 어짜피 예를 들어서 calendar data 같은 것들은 엄청 작을텐데? 큰 데이터는 WIFI 연결 되었을 때만 보내기 이런 설정 같은 걸 할 수 있게끔하고

> 쌍마다 페어링하는 건 좀 그런데. 4가지가 있다고 쳐 폰, 집, 직장, 미니피씨 이걸 조합하는 경우의 수만큼 […] 따로 따로 페어링을 일일이 다 해야한다는거야? → (조사 뒤) 방식은 1로 가자

> 누가 무엇을 해도 되나에 대해서는 기존의 approval이랑 크게 다를 게 없을 거 같은데? […] 우리 기존에도 workspace 별로 private, public 설정하는 게 있는데 그거를 어떻게 잘 활용하고 만져야할 듯

> (어떻게 보이나) 내 머신에서도 보고 싶으니까 remote를 하는 게 아니겠어?

> workspace id는 어떻게 할 생각이야. data sync에서든 app remote use에서도 이 문제가 중요할 것 같은데 → home도 따로 두는 게 맞을 듯

## 원칙

- lophn은 사용자의 환경을 요구하지 않는다. 가진 것에 맞는 길을 준비해 두고, 환경이 좋을수록 더 좋은 길을 쓴다.
- 될 수 있는 것이 먼저다. 빠르기는 환경이 좋아질수록 얻는 것이다.
- 길은 lophn이 환경을 보고 스스로 고른다. 사람에게는 지금 어느 길인지를 보인다.
- 중심 기계를 "둔다, 안 둔다"를 정하지 않는다. 늘 켜 둔 기계가 있으면 쓰고 없으면 다른 길로 간다.
- 사람은 숲을 정한다. 중복, 순서, 크기, 수명 같은 것은 구현이 정한다.

## 숲

| 층 | 정한 것 |
|---|---|
| 무엇을 주고받나 | remote, event, data 맞추기, a2a. 바닥은 "기계들이 서로를 안다" |
| 누가 누구에게 | 사람·agent·앱·lophn 자체가, 다른 기계의 대화·터미널·앱·browser에게 |
| 어떻게 가리키나 | "무엇 + 어느 기계" |
| 어느 길로 | 둘 다 켜져 있으면 이어서 바로, 한쪽만 켜져 있으면 맡겨 두었다 나중에 |
| 해도 되나 | 지금의 approval 그대로. 요청한 쪽에 기계가 붙는다. workspace의 private 설정을 기계 사이로 넓힌다 |
| 어떻게 보이나 | 지금 있는 화면 하나에 내 모든 기계의 것이 보인다 |
| 어떻게 한 묶음이 되나 | 내 기기 명단. 이미 든 컴퓨터 하나가 승인하면 나머지에 퍼진다 |

## 주고받는 것 네 가지

| 종류 | 요청·구독하는 주체 | 응답·내는 주체 | 대상 | 전달하는 것 |
|---|---|---|---|---|
| remote | 사람(화면으로), agent, 앱 | 대상이 있는 기계의 lophn | 대화, 터미널, 앱(command, 화면), browser page, file, job | 읽기와 시키기가 가고 결과나 거절이 온다 |
| event | 구독하는 쪽: 화면(사람), agent, 앱, lophn 자체(알림과 배지를 만든다) | 내는 쪽: 일이 일어난 기계의 lophn(폰 포함) | 대화의 변화, 승인 대기, 앱이 내는 event, 상태 바뀜 | 구독 요청이 가고, 일어날 때마다 사실이 온다 |
| data 맞추기 | 같은 앱의 사본을 가진 lophn | 다른 사본을 가진 lophn | 앱 data, 앱 release와 source, 기계 기록, 기기 명단 | 변경 묶음, 통째 사본 |
| a2a | 한 기계의 agent | 다른 기계의 agent | 일 | 맡기는 일과 맥락, 결과. handoff는 그 한 경우다 |

- 자리: 컴퓨터(온전한 lophn이 돈다. desktop PC, 늘 켜 둔 미니 PC, VM), 폰(화면과 폰에서 도는 앱의 사본. agent는 돌지 않는다).
- 운반자는 주체가 아니다: relay, OS의 push, 폴더 도구. 옮기기만 하고 내용을 읽지 못한다.
- remote와 event의 경계: 기기가 먼저 묻는 것은 remote, 기계가 먼저 알리는 것은 event다. 알림은 종류가 아니라 event를 사람에게 보이는 방법 하나이고, push는 event의 운반 수단 하나다.
- remote와 a2a의 경계: remote의 대상은 정해진 동작을 가진 것(앱의 command)이고, a2a의 대상은 스스로 판단하는 agent다.
- data 변경에 딸린 event는 그 data가 도착한 기계에서 낸다. data 없이 알리기만 하는 event만 따로 나른다. 그래서 data가 가는 길이 곧 그 event가 가는 길이다.
- session의 기록(transcript, tool 이력)은 기계 사이에 맞추지 않는다. 기계마다 환경이 달라 옮겨도 뜻이 없다. 다른 기기는 그 기계에 붙어서 쓴다(remote).

## 가리키는 법

- 주소는 "무엇 + 어느 기계"다. data 맞추기는 "무엇"만 쓰고(같은 것의 모든 사본) remote, event, a2a는 둘 다 쓴다(지금 그 기계에서 도는 그것).
- project와 앱은 기계를 건너는 정체를 하나씩 갖는다. 기계마다 다른 id는 그 기계 안의 사정이다.
- Home은 기계마다 따로다. 정체가 없고 "어느 기계의 Home"으로만 가리킨다. 여러 기계의 Home을 하나로 합치지 않는다.
- 권한(private 포함)도 이 주소에 건다.

## 길

두 층이다. 네 종류가 첫 층은 똑같이 쓰고 둘째 층에서 갈린다.

**닿는 길(둘 다 켜져 있을 때).** 되는 길을 다 걸어 보고 먼저 닿는 쪽을 쓴다.

| 사용자 환경 | 길 | 한계 |
|---|---|---|
| 아무것도 없음 | lophn relay | 속도와 크기 한도, relay를 한 번 거친다 |
| 같은 network | 직접 | 밖에서는 안 된다 |
| Tailscale | 직접(어디서나) | 양쪽에 깔아야 한다 |
| 공인 주소가 있는 VM | 직접(어디서나) | 사람이 주소를 적는다 |

**맡겨 두는 곳(한쪽만 켜져 있을 때).** 보내는 쪽이 내놓고 받는 쪽이 켜졌을 때 가져간다.

| 맡겨 두는 곳 | remote | event | data 맞추기 |
|---|---|---|---|
| 보내는 쪽이 들고 있기 | 안 된다 | 다시 만났을 때 간다 | 다시 만났을 때 간다 |
| 폴더(공유 디스크, Google Drive, Syncthing) | 안 된다 | 늦게 간다 | 늦게 간다 |
| 폰이 나른다 | 안 된다 | 늦게 간다 | 늦게 간다 |
| 늘 켜 둔 기계(미니 PC, VM) | 그 기계의 것은 언제든 | 그 기계가 받아 두었다 전한다 | 그 기계를 거친다 |
| OS의 push | 안 된다 | 폰의 앱이 꺼져 있을 때 사람을 부르는 것만. 내용은 싣지 않는다 | 해당 없음 |

- remote만 맡겨 둘 수 없다. 꺼진 기계의 것을 지금 쓸 수는 없고 그 자리는 a2a가 대신한다(나중).
- 집과 직장(같은 때 켜지지 않는다)은 폰이 나르거나 cloud 폴더로, dual boot는 두 OS가 같이 보는 디스크의 폴더로 된다.
- 폰은 기준이 아니라 운반 수단이다. 한 컴퓨터가 낸 묶음을 받아 두었다가 다른 컴퓨터에 붙었을 때 넘긴다. 폰을 잃어도 못 전한 묶음이 늦어질 뿐이다. 큰 묶음은 Wi-Fi일 때만 보낸다(기준 크기는 설정).
  - 합치는 것은 받는 컴퓨터가 지금 규칙(덮지 않고 합친다)으로 한다. 폰에 화면이 없는 앱의 data도 내용을 모르고 나르고, 전하고 나면 지운다.
  - 한계: 폰 앱이 뒤로 가면 연결이 끊기므로 사람이 앱을 열 때 움직인다.
- 한 묶음이 두 길로 같이 가도 된다(폰과 폴더). 받는 쪽이 같은 묶음을 한 번만 적용한다.
- 폴더 길은 이미 되지만 설정 화면이 없고 실제 도구(Google Drive, Syncthing)로 돌려 본 적이 없다. `carry-paths`가 한다.
- 여러 기기가 같은 session이나 터미널을 같이 다룰 때의 충돌(같은 때 보내기, 같은 승인에 두 기기가 답하기, 터미널 크기와 입력)은 remote의 일이고 이슈로 고친다(`project-docs/issues/`의 topic `remote`).

## 해도 되나

- 지금의 approval을 그대로 쓴다. "시킨 것이 승낙이고 할당이 허락이다." 요청한 쪽의 이름에 "어느 기계의"가 붙을 뿐이다.
- 사람이 다른 기계의 것을 쓰는 것은 기기의 범위(기기마다 다를 수 있다)가 정한다. agent가 다른 기계의 앱을 쓰는 것은 그 앱의 할당이 정한다. 물을 것은 같은 승인 card로 묻고, card는 사람이 지금 있는 기기로 간다(event).
- workspace의 private 설정(`architecture/agent-call.md`의 call 정책)을 넓혀 쓴다. private은 agent와 앱 사이를 끊는 것이고 사람을 막지 않는다.

## 어떻게 보이나

- 사람은 지금 앉은 기계나 폰의 화면 하나에서 내 모든 기계의 것을 본다. 어느 기계의 것인지는 줄마다 붙는 꼬리표다.
- 대상은 대화, coding agent, 터미널, 앱의 화면, browser page다.

## 어떻게 한 묶음이 되나

- 한 사람의 기기들은 "내 기기 명단"을 같이 든다. 새 기기는 이미 든 컴퓨터 아무거나 하나가 승인하면 명단에 오르고 명단이 나머지에 퍼진다. 기기 넷에 pairing 세 번이다(지금은 방향마다 따로라 아홉 번까지).
- 기기를 잃으면 아무 기기에서나 명단에서 뺀다. 소식이 닿는 대로 나머지가 끊는다.
- 명단이 퍼지는 길은 위 "길" 그대로다.
- 조사한 제품 가운데 이것을 하는 것은 없다(쌍마다 잇기, 계정, 가운데 기계, 공유 비밀 하나). 본보기 없이 설계한다. 버린 길: 계정(lophn 서버가 기기 목록을 쥔다), 가운데 기계(없는 사람은 못 쓴다), 공유 비밀 하나(기기 하나만 뺄 수 없다).

## 하지 않는 것

- session의 기록을 기계 사이에 맞추기, 폰에 대화를 저장하기.
- a2a와 handoff(이번 계획들에서 뺀다. multi-device orchestrator를 다듬을 때 다룬다).
- lophn의 relay나 서버가 사용자 data나 key를 맡아 두기.
- 길을 사람이 손으로 고르는 설정. 예외는 큰 묶음의 Wi-Fi 규칙처럼 비용에 걸린 것이다.
- 여러 기계의 Home을 하나로 합치기.

## 사람이 정한 것 (2026-11-17, planner의 추천을 받았다)

- **Tailscale은 lophn 안에 넣지 않는다.** 있으면 알아서 쓰고, 없는 사람은 lophn agent가 지침대로 설치와 설정을 돕는다(폴더 도구와 같은 방식). `carry-paths`가 한다. 버린 길: lophn 안에 Tailscale 연결을 넣기(그 변화를 lophn이 따라가야 한다).
- **private은 기계 사이에도 선다.** private의 뜻을 "바깥과 섞이지 않는다"로 넓혀 바깥에 "다른 workspace"와 "다른 기계"를 둘 다 넣는다. private인 workspace의 agent와 앱은 다른 기계를 부르지 못하고 다른 기계에서도 불리지 않는다. 사람의 화면은 private이어도 보고, data 맞추기는 private과 따로다(같은 것을 여러 곳에 두는 것이지 섞이는 것이 아니다). `remote-use`가 한다.
- **터미널 입력 허락은 컴퓨터마다 따로다(2026-11-19).** 각 컴퓨터는 자기에서 켠 허락만 인정한다. 명단의 칸으로 두면 명단의 컴퓨터가 자기 허락을 스스로 켤 수 있어서다(이슈 `roster-computer-self-grants-terminal-input`). `remote-use`의 `use-grant`가 한다. 버린 길: 명단의 컴퓨터끼리는 온전히 믿는다고 두기(꺼 둔 스위치가 꺼져 있지 않다).
- **직접 주소를 pairing 뒤에도 새로 받는 것과 사람이 적는 주소 설정(`remote.addresses`)은 둔다.** 계획 `issue-sweep`이 답을 받기 전에 넣었던 것이다. "닿는 길"의 표와 맞는다.

## 순서와 계획

| 순서 | 계획 | 무엇 | 기대는 것 |
|---|---|---|---|
| 1 | 가리키는 법(끝남. 계획 폴더 없이 한 줄. 아래 "순서 1") | project가 기계를 건너는 정체를 갖고(git이 아니면 ledger에서, git이면 id file에서), 앱이 그 정체로 data를 key한다 | 없음 |
| 2 | `device-roster`(끝남) | 내 기기 명단. 한 번 들이면 다 이어진다 | 없음 |
| 3 | `core-terminals`(끝남), `core-setup`(끝남), `core-browser`(끝남, `shell-as-client.md`) | 일을 core로 옮긴다 | 없음 |
| 고침 | `multi-device-fixes`(끝남) | 순서 1~3의 review에서 확인한 구멍: 권한 경계, 명단의 서명 규칙, data를 옮기는 길, 설치본 | 1, 2, 3 |
| 4 | `one-screen` | 지금 있는 화면에서 다른 기계의 대화, coding agent, 터미널, 앱 화면, browser를 본다 | 고침, `core-browser`(page만) |
| 5 | `carry-paths` | 맡겨 두는 길: 폰이 나른다, 컴퓨터끼리 연결로 맞춘다, 같이 보는 폴더, 들어온 변경을 앱에 알린다, 폴더 길의 설정 화면 | 고침 |
| 6 | `remote-use` | agent와 앱이 다른 기계의 앱을 쓰고 그 event를 받는다. 사람의 터미널이 다른 기계에 명령을 보낸다. private을 넓힌다 | 4, 5 |

고침은 끝났다(남은 명단의 한계는 change-log `multi-device-fixes`의 이슈). 4와 5는 같이 돈다. 6은 4와 5가 올라간 뒤에 시작한다(같은 연결과 route 목록 file을 고치고, 구독의 바닥이 4에 있다). review와 다시 한 조사는 `reports/multi-device/review-*.md`, `survey-n1`~`n3`에 있다.

## 순서 1: 가리키는 법

조사해 보니 일이 둘이고 뒤의 것이 앞의 것에 기댄다. 그래서 계획 폴더를 열지 않고 branch 하나에서 worker 하나가 잇는다(`planner-persona` skill "한 줄").

정한 것:
- **project의 id는 지금처럼 둘이다.** 기록의 key는 기계마다 다른 `prj_`이고, 기계를 건널 때는 `pri_`를 쓴다(`architecture/project-identity.md`). `prj_`를 기계 사이에 하나로 맞추지 않는다. 맞추려면 모든 표와 file과 앱 DB 안의 key를 고쳐야 하고 `events`는 고칠 수 없다. (agent)
- **다른 기계의 것은 그 기계의 id로 부른다.** 화면과 agent는 그 기계에 목록을 물어 그 기계의 id를 받아 쓴다(지금 다른 기계 창이 하는 방식). 그래서 주소에 새 type이 필요 없고 "어느 기계"만 붙는다. "내 project와 같은 project"는 `pri_`로 찾는다(`project.list { identity }`). (agent)
- **모든 project가 `pri_`를 가질 수 있다.** git이 아닌 project는 ledger에서 정체를 얻고, 다른 기계의 project와 같은 것으로 잇는 것은 사람이 고른다(잇는 화면은 `one-screen`). (agent)
- **git project는 id를 file에서만 얻는다**(change-log `project-address` 결정 2). ledger에서 id를 내지 않아 id file이 없는 git project는 `identity`가 null이다. git이 답하지 않는 폴더(`.git`이 있다)는 git이 아닌 것으로 보지 않고 아무것도 쓰지 않는다. (agent)
- **앱은 기계 사이에 맞추는 data를 `pri_`로 key한다.** 지금 앱은 `prj_`로 key해서, 맞춰진 data가 다른 기계에서는 주인 없는 줄이 된다. 앱이 받는 project에 정체를 더하고(`AppProject`, `place.workspace`), 지침을 고치고, 이미 있는 앱을 옮기는 `migrate-sdk` 메모를 쓴다(`sdk-note` skill). (agent)
- 앱 id는 이미 기계를 건넌다. Home은 기계마다 따로다. 둘 다 고칠 것이 없다.

할 일(순서대로): git이 아닌 project에 정체 만들기와 그 migration → 앱이 받는 project에 정체 싣기와 SDK 지침·메모. 조사: `reports/multi-device/survey-s1-address.md`.

## 끝나면 되는 것

- 새 폰이나 컴퓨터를 이미 쓰던 기기 하나와 한 번만 pairing하면 내 모든 기계와 이어진다. 잃어버린 폰은 아무 기계에서나 뺀다.
- 직장 PC의 lophn에서 집 PC의 대화, coding agent, 터미널이 내 것과 같은 목록에 보이고 그 자리에서 이어서 시킨다. 폰의 목록 하나에 모든 기계의 session이 보인다.
- 다른 기계에 있는 앱의 화면과 agent의 browser 화면을 지금 있는 기계에서 열어 보고 끼어든다.
- 집에서 앱에 쓴 것이 직장 PC를 켰을 때 와 있다(폰이 나른다). dual boot의 두 OS 사이에서도 맞는다. 늘 켜 둔 기계가 있으면 바로 맞는다.
- 다른 기계에서 일어난 일이 늦게라도 도착해 이 기계의 앱과 agent가 반응한다.
- 내 PC의 agent가 VM의 monitoring 앱에 상태를 묻고, 그 앱의 event를 구독한다.
- 화면 없는 VM을 폰이나 다른 기계에서 처음부터 설정하고, 거기서 coding agent, 터미널, browse job이 돈다(`shell-as-client.md`).

여전히 안 되는 것: 꺼진 기계에서 하던 일을 다른 기계가 넘겨받기, 다른 기계의 agent에게 일을 맡기기(a2a), 대화 기록이 기계 사이에 맞는 것(하지 않는다).

## 지금 code (2026-11-17, 순서 1~3 전의 모습)

아래는 계획들을 열기 전의 사실이다. 지금 code는 architecture 문서(`remote.md`, `terminal-agent.md`, `project-identity.md`)와 `reports/multi-device/survey-n1`~`n3`이 적는다.

조사한 날의 main(0.23.80)이다. 자세한 것은 `reports/multi-device/survey-s1-address.md`, `survey-s2-roster.md`, `survey-s6-remote-events-sync.md`에 있다.

**가리키는 법**
- 기계 id(`mch_`)는 `<data root>/machine.json`에 있고, 어떤 주소에도 들어 있지 않다. workspace, session, project, 앱, agent의 id와 bus event, route, CLI 어디에도 기계가 없다. 기계가 나오는 곳은 remote의 hello, folder sync의 path와 표, `jobs.machine`, `app_sync_log.machine`뿐이다.
- workspace를 가리키는 type `Workspace`(`packages/protocol/lophn-agent/workspaces.ts`)를 150개 file이 import한다(core 44, shell 37, protocol 31, mobile 19, cli 18). Home은 `null`이다.
- project는 id가 둘이다. 기계마다 다른 `prj_`가 모든 기록의 key이고, 기계를 건너는 `pri_`는 git 저장소 안 `.lophn-project.json`에 있다. git이 아닌 project는 건너는 id가 없다. (순서 1 뒤) git이 아닌 project와 폴더 없는 project는 ledger에서 난 `pri_`를 갖는다.
- 앱 id는 이미 기계를 건넌다. 다른 기계의 앱을 들일 때 같은 id로 등록한다. slug는 기계 안에서만 하나다.
- 앱은 자기 data를 `prj_`로 key한다(SDK가 그렇게 준다). 그래서 기계마다 다른 id가 맞춰지는 앱 data 안에 실려 다닌다. (순서 1 뒤) 앱은 project의 `identity`를 받고 `identity ?? id`로 key한다(`@lophn/app-ui` 2.19.0).
- agent를 부르는 주소(`{agent, workspace}`)는 그 기계 안의 이름으로 푼다. CLI는 자기 data root의 core에만 붙고 기계를 고르는 인자가 없다(명령 76개).

**기기와 믿음**
- (계획 `device-roster` 뒤) 폰과 컴퓨터는 서명한 명단 하나를 같이 든다. 이미 든 컴퓨터 하나의 초대장으로 들어오면 모든 컴퓨터와 이어지고, 빼기는 어느 컴퓨터에서나 해서 명단을 따라 퍼진다. 기기 id와 터미널 입력 허락은 명단에서 하나다(`architecture/remote.md`의 "내 기기 명단").
- 컴퓨터끼리는 core가 명단의 다른 컴퓨터마다 link를 든다. 다른 기계의 창은 core의 `machines/call`·`machines/watch`로 부르고 shell에는 붙는 key와 목록이 없다. 화면 없는 기계는 `lophn remote invite|join`으로 든다.
- 기기가 부를 수 있는 것은 route 109개, 받는 event 20개로 폰과 desktop이 같다. 기기마다 다른 것은 터미널 입력 허락 하나다.
- "기기 목록" 비슷한 것은 둘이다: 명단과 folder의 `machines/<mch>/record.json`(이름과 주소, key 없음).

**remote**
- 다른 기계를 보는 desktop은 기계 하나에 창 하나다. 그 창은 대화 목록, 대화, 승인, Inbox, job만 다룬다. 터미널, browser, 앱 화면, agent가 연 탭은 꺼져 있다. 두 기계의 session은 나란히 있고 한 목록에 섞이지 않는다.
- 폰은 고른 컴퓨터 하나의 것만 보인다(link는 컴퓨터마다 하나씩 열려 있다).
- 다른 기계를 부르는 것은 사람의 기기뿐이다. agent, 앱, CLI는 다른 기계를 부를 수 없다. `call` frame에 "어느 기계" 칸이 없다.

**event**
- bus는 memory에만 있고 쌓아 두지 않는다. 구독은 그 기계의 화면과 그 기계에 등록한 기기만 한다. agent와 앱은 구독하지 못한다.
- core에서 core로 건너는 event는 없다. B에 붙은 화면이 B의 event를 볼 뿐이고, A의 앱, job, 알림에는 닿지 않는다.

**data 맞추기**
- 길이 둘이고 서로 따로다. 폰과 컴퓨터는 remote 연결 위에서 컴퓨터를 가운데 두고 맞춘다(`app_sync_log`). 컴퓨터와 컴퓨터는 같이 보는 폴더의 file로 맞춘다.
- 들어온 변경을 적용해도 그 기계의 앱 process와 앱 화면에는 event가 가지 않는다(`AppSyncChanged`와 `StateChanged`만 난다).
- 폰이 한 컴퓨터에서 받은 변경을 다른 컴퓨터에 넘기는 길은 없다.

**이미 있어 쓸 수 있는 것**
- 붙는 engine `packages/remote-client`는 화면과 무관하고 폰과 desktop이 같이 쓴다. `tools/remote-client.ts`가 화면 없이 붙는 예다.
- 화면이 core를 읽는 모양 `CoreSource` 하나를 desktop 화면과 폰이 같이 쓴다. 앞에 "어느 기계"를 고르는 층을 둘 수 있다.
- 기기가 부를 수 있는 route와 event는 code가 아니라 목록이다(`packages/protocol/remote/allowlist.ts`).
- job에는 이미 "어느 기계의 것"이 있다(`jobs.machine`).
- 복사한 data root를 알아채는 표지 규칙(`architecture/machine.md`).
