# attention

사람을 기다리는 일(승인, 질문, 터미널 coding agent의 대기, 앱의 동의·공유 요청, job의 놓친 차례)과 오래 돈 turn의 끝, 앱의 `notify()`를 어느 기기에 알릴지 정하는 메커니즘이다. core가 host(desktop, 폰)의 보고로 "사람이 지금 무엇을 보고 있나"를 알고, 못 본 turn 끝(`unseen`)을 들고, 보고 있지 않은 폰에 Expo Push를 직접 보낸다. desktop 안에서 toast와 OS 알림 중 무엇을 띄울지는 이 문서가 아니라 shell의 정책이다(`app-notice.md`, `terminal-agent.md`).

## 문제

- 사람이 desktop 앞에 없으면 승인과 질문이 하루 종일 기다린다. 폰이 붙어 있어도 core가 알리지 않으면 폰은 사람이 앱을 열어야만 안다.
- 알림은 사람이 보고 있지 않을 때만 뜻이 있다. desktop은 shell main이 창 focus를 알았다. 폰이 둘째 host가 되면 "누가 보고 있나"를 한 곳이 알아야 한다. 그렇지 않으면 desktop 앞에 앉은 사람의 폰이 울리거나, 폰에서 이미 읽은 일이 desktop에 점으로 남는다.
- 못 본 turn 끝(`unseen`) 점이 shell main 메모리에 있어 폰에서 읽어도 desktop의 점이 꺼지지 않았다. 터미널 coding agent의 대기와 끝도 shell main의 tracker만 알아서 core가 폰에 알릴 수 없었다.
- 알림 글은 Expo와 Google을 평문으로 지난다. 대화 내용이나 명령이 거기 실리면 안 된다.

## 목표와 비목표

- 목표: 사람을 기다리는 일이 새로 생기면 보고 있지 않은 폰에 상태 한 문장을 보낸다. 누르면 그 컴퓨터의 그 session, 앱, Inbox로 간다. `unseen`을 core가 한 곳에서 들어 폰에서 읽으면 desktop 점도 꺼진다.
- 목표: 실제 Expo endpoint를 개발과 test에서 부르지 않고도 이 길 전체를 확인한다(fake push server).
- 비목표: iOS(APNs, Apple 계정). 암호화한 push(native 확장이 글을 푸는 길). 폰의 알림 목록 화면. 알림 묶기·지연 같은 다듬기. lophn이 도는 push gateway. 터미널 coding agent session을 폰에서 여는 화면(그 push는 가고, 누르면 Inbox로 간다). desktop의 toast·OS 알림 정하기.

## 모델

```
desktop(shell main) ─ presence/report ─┐
폰 ─ presence/report ───────────────────┤
                                        ▼
                     presence 표(host마다 마지막 보고, 메모리)
Bus event ─────────┐                    │
terminal_sessions/signal ─▶ 계기 ─┬▶ unseen(서고 꺼질 때 StateChanged{unseen})
                                  └▶ 기기마다 알릴지 정하기 ─▶ 글 만들기 ─▶ Expo Push ─▶ 폰
```

- **presence.** host가 core에 알리는 지금의 모습이다: 창이나 앱이 앞에 있는지(`focused`), desktop만 마지막 입력 뒤 지난 시간(`idle_ms`, OS가 아는 시간), 보이는 session 참조(`looking`, `ses_…`이고 터미널은 `term:<탭>`, 32개까지). 누가 보고했는지는 입력이 아니라 자격이 정한다(기기는 `device:<id>`, shell main은 사람 자격). 기기의 보고는 받을 때 그 기기의 kind로 폰 규칙인지 정한다. 메모리뿐이고 표가 없다. desktop은 focus나 보이는 것이 바뀔 때, 30초마다, core에 다시 붙을 때 보낸다. 폰은 앱이 앞뒤로 갈 때, session 화면이 열리고 닫힐 때, 앞에 있는 동안 30초마다 보낸다. 기기가 마지막 연결을 닫거나 끊기면 그 기기의 보고를 잊는다.
- **앞에 있다.** kind `phone` 기기는 앱이 앞에 있을 때다. desktop(shell main과, 다른 기계의 lophn이 kind `desktop` 기기로 붙어 보고한 것)은 창에 focus가 있고 마지막 입력 뒤 2분이 지나지 않았을 때다(idle을 모르면 지나지 않은 것으로 본다). 그래서 다른 기계의 desktop 앞에 앉은 사람도 `quiet_when_present`의 "앞에 있는 desktop"이다. push는 token이 있는 기기, 곧 phone에만 간다. 90초 넘게 보고가 없는 host는 앞에 없다.
- **unseen.** 못 본 turn 끝이다. session 참조마다 `finished`나 `failed`와 시각을 메모리에 둔다.
  - 서는 때: 완료나 실패로 끝난 turn(끊은 turn과 앱이 연 session의 turn은 뺀다)과 터미널의 끝·실패 signal. 앞에 있는 host가 그 session을 보고 있으면 서지 않는다. 승인과 질문의 대기는 unseen이 아니다(waiting 표시가 맡는다).
  - 꺼지는 때: 앞에 있는 host가 그 session을 새로 보고 있다고 알릴 때, 다음 turn이 시작할 때, session이 끝날 때, 터미널의 waiting signal이 올 때, 사람이 지울 때(`unseen/dismiss`). 터미널은 core가 turn 시작과 끝남을 모르므로 shell이 새 turn과 종료를 알려 지우게 한다.
  - 서고 꺼질 때마다 `StateChanged{unseen}`이 나간다(`id`는 session 참조). desktop은 `unseen/list`를 읽고 `unseen/dismiss`로 지우기만 한다. 폰은 읽지 않는다. 폰이 session을 보고 있다고 알리면 그 점이 꺼진다.
- **계기.** 무엇을 알릴 계기로 치는지의 표는 한 곳이다.

  | 계기 | 설정 칸 | channel | 우선순위 | 누르면 |
  |---|---|---|---|---|
  | 승인(`TurnRequestOpened`), 질문(`QuestionAsked`), 터미널 coding agent의 대기 | `needs_you` | `needs-you` | high | 그 session. 터미널은 폰이 열 수 없어 Inbox |
  | 60초 넘게 일한 turn의 완료·실패(터미널 포함) | `long_finish` | `finished` | default | 그 session. 터미널은 Inbox |
  | 앱의 activation 동의, 공유 요청, 사람이 알아야 하는 program 기록(release 실패와 되돌림, 앱 사용 불가, data 복원, SDK 업데이트 필요) | `app_update` | `apps` | default | 그 앱, 앱이 없는 기록과 동의·공유 요청은 Inbox |
  | 앱의 `notify()`(`NoticePosted`의 앱 줄, 안 읽은 것) | `app_notify` | `apps` | default | 그 앱 |
  | job의 놓친 차례가 새로 held가 됨(`JobHeld`) | `job_missed` | `needs-you` | default | Inbox |

  팀 자식의 승인과 질문은 부모가 푸니 계기가 아니다. 앱이 연 session의 승인은 사람이 가야 풀리므로 계기이고 그 turn 끝은 아니다(앱이 turn마다 agent를 부려 쓴다). 켜짐·data migration·lophn 업데이트 같은 program 기록은 Inbox에만 남는다.
- **알릴지 정하기.** 계기 하나마다 push token이 있는 기기마다 정한다. 그 기기의 설정 칸이 꺼져 있으면 보내지 않는다. 그 폰이 앞에 있으면 그 폰에는 보내지 않는다(다른 폰에는 보낸다). 그 폰의 `quiet_when_present`가 켜져 있고 앞에 있는 desktop이 있으면 보내지 않는다. 지연이 없어 한 번 정하고 끝이다. 어느 session을 보고 있는지(`looking`)는 알릴지를 정하는 데 쓰지 않고 `unseen`에만 쓴다. event와 signal은 한 줄로 처리해 읽기가 끝나는 순서가 event 순서를 뒤집지 않는다.
- **push 글.** core가 영어 고정 문장으로 다 만든다(OS가 그리는 글을 폰이 고칠 수 없고 core에 i18n이 없다). 제목과 상태 한 문장뿐이다. 고정 문장에 session 제목, agent 이름(터미널은 harness 이름), 앱 이름, job 이름, 앱이나 program이 낸 notice의 제목만 끼운다. 대화 글, 명령, 질문 글, 마지막 답, notice의 본문은 어디에도 싣지 않고 컴퓨터 이름도 싣지 않는다. 제목은 120자, 본문은 200자에서 자른다. 폰의 `show_names`가 꺼져 있으면 이름 없이 "An agent needs you" 같은 일반 문장이 간다. `data`에는 어느 컴퓨터의 어디를 열지만 싣는다: 컴퓨터의 공개 key 글(`host`), `kind`(`session`, `app`, `inbox`), `session`이나 `app`. 보낸 지 1시간이 지난 글은 Expo가 버린다.
- **보내기.** core가 Expo Push HTTP API를 직접 부른다. send 주소는 잠긴 설정 `remote.push`(기본은 Expo의 send 주소, 비우면 push를 끈다)이고 영수증 주소는 끝의 `/send`를 `/getReceipts`로 바꿔 만든다. 일시 오류(네트워크, 429, 5xx)는 1, 2, 4초 뒤 세 번까지 다시 하고 그 밖의 실패는 바로 버린다. queue를 두지 않는다. ticket의 id를 기억해 보낸 지 15분 뒤 영수증을 한 번 묻는다. 죽은 token(`DeviceNotRegistered`)이 ticket이나 영수증에서 알려지면 core가 그 기기의 token을 지운다(`devices/clear_push`. 그 사이 폰이 새 token을 보냈으면 그대로 둔다). 설정 칸은 남고, 폰이 다시 붙을 때 `devices/set_push`가 새 token을 둔다.
- **기기 쪽.** 기기 목록(token과 설정 칸)과 컴퓨터의 공개 key 글은 remote가 attention에 꽂는다(`remote.md`). attention은 다른 feature module을 import하지 않는다. 컴퓨터의 key는 remote가 처음 켜질 때 풀리고, 풀리기 전에는 보낼 곳이 없는 것으로 친다.
- **폰의 설정.** 설정 칸은 일곱이다: `needs_you`, `long_finish`, `app_update`, `job_missed`, `app_notify`, `quiet_when_present`, `show_names`. 폰 하나에 있고 pairing한 모든 컴퓨터에 사본으로 간다.

## 지키는 것

1. push 글에는 대화 내용, 명령, 질문 글, 마지막 답, notice의 본문, 컴퓨터 이름을 싣지 않는다. 싣는 것은 고정 문장과 session 제목, agent 이름, 앱 이름, job 이름, notice 제목뿐이고 `show_names`가 꺼져 있으면 고정 문장만이다.
2. 사람이 보고 있는 기기에는 알리지 않는다: 앞에 있는 폰에는 그 폰에 보내지 않고, 앞에 있는 desktop이 있고 `quiet_when_present`이면 그 폰에 보내지 않는다.
3. 90초 넘게 보고가 없는 host는 앞에 없다. 죽은 desktop이 push를 영원히 막지 않는다. 기기가 마지막 연결을 닫으면 그 기기의 보고를 잊어 연결이 끊긴 폰이 앞에 있는 것으로 남지 않는다.
4. 누가 보고했는지와 어느 규칙(폰, desktop)을 따르는지는 자격과 그 기기의 kind가 정한다. 입력으로 고르지 못한다. 폰은 자기 이름으로만 보고하고 `terminal_sessions/signal`은 사람 자격(shell main)만 부른다.
5. `unseen`의 정본은 core 하나이고, 서는 때와 꺼지는 때의 규칙은 한 곳에 있다. desktop은 읽고 지우기만 한다.
6. 개발과 test는 실제 Expo endpoint를 부르지 않는다. `remote.push`가 가리키는 곳만 부르고, 그 설정은 locked라 사람만 바꾼다. 개발 core는 fake push server를 가리키고 test용 core는 비워 push를 끈다.
7. push는 기록이 아니다. 못 보낸 글은 다시 보내지 않고 버린다(일시 오류의 재시도 셋만 빼고). 놓친 것은 Inbox가 기록으로 남긴다.
8. 죽은 token을 지울 때 그 사이 폰이 보낸 새 token을 지우지 않는다.
9. 앱이 연 session의 turn 끝과 팀 자식의 승인·질문은 알릴 계기가 아니다.

## 경계와 계약

- boundary `attention`. route: `presence/report`(desktop은 shell main, 폰은 기기 route 목록에 있다), `unseen/list`, `unseen/dismiss`, `terminal_sessions/signal`(사람 자격만).
- 기기 쪽 route `devices/set_push`(폰), `devices/clear_push`, `devices/push_targets`(core 안 machine)는 `remote.md`가 맡는다.
- event: `JobHeld`(새 held 줄이 commit된 뒤 한 번. 이미 있는 줄이 갱신될 때는 내지 않는다. Inbox는 `StateChanged{jobs}`로 다시 읽으므로 폰 event 목록에는 없다). `StateChanged`의 change 이름 `unseen`(`event.md`).
- 설정 `remote.push`(locked). 폰의 설정 칸 일곱(`pushPrefsSchema`).
- push 글의 channel id `needs-you`, `finished`, `apps`는 폰이 시작 때 만드는 channel id와 같은 계약이다. `data`의 모양은 `{host, kind, session?, app?}`이고 폰은 모양이 틀리면 아무것도 열지 않는다(해석은 위젯과 홈 화면 아이콘의 누름과 같은 open target 하나다. `phone-home-screen.md`).

## 결정

- 배달은 Expo Push를 core가 직접 부른다. 이유: lophn이 gateway를 돌리면 service 하나와 FCM key를 lophn이 쥐어야 하는데, 글이 어차피 평문이라 privacy를 얻는 것이 없다. 대가: 알림 글(상태 문장과 제목)을 Expo와 Google이 본다. 버린 안: lophn gateway, push를 두지 않기. (agent)
- 알림 설정은 폰 하나에 한 벌 있고 pairing한 모든 컴퓨터에 사본으로 보낸다. 이유: 컴퓨터마다 따로 두면 화면이 늘고, 폰 하나가 컴퓨터 둘에서 다르게 울릴 이유가 없다. (agent)
- 앞에 있는 host가 있으면 보내지 않는다. 알릴지는 host 단위(`present`)로만 정하고 보는 session은 `unseen`을 위해서만 쓴다. 이유: session까지 맞추면 보고가 session 화면마다 오가고, 사람이 desktop 앞에 있으면 어느 session이든 직접 본다. (agent)
- 창이 앞에 있어도 마지막 입력 뒤 2분이 지나면 앞에 없는 것이다. 이유: 창을 띄워 놓고 자리를 비운 사람에게 push가 가야 한다. 대가: 보이는 창이 쉬는 사이 끝난 session에도 `unseen`이 선다(의도). (agent)
- 터미널 coding agent의 대기와 끝은 core가 `coding_report`(터미널 집합 보고)의 변화를 비교해 알아내지 않고 shell main의 tracker가 1.5초 debounce 뒤 `terminal_sessions/signal`로 알린다. 이유: 상태 해석은 tracker 한 곳에 두고 core는 순간만 받는다. 버린 안: report 변화 비교(같은 해석이 core에 두 벌이 된다). (agent)
- push 글은 영어 고정 문장이다. 이유: core에 i18n이 없고 글을 OS가 그린다. 폰 화면의 문구는 `@lophn/i18n`이다. (agent)
- session 제목을 싣는 것이 기본이고(`show_names`) 스위치 부제에 제목이 Expo와 Google을 지난다고 쓴다. 이유: 제목은 대화에서 나온 글이라 사람이 알고 고르게 한다. 컴퓨터 이름은 싣지 않는다(QR에 이름이 없다). (agent)
- Expo의 "enhanced push security"(access token)를 켜지 않는다. 이유: 열린 build에 token을 실을 수 없다. 대가: 폰의 push token을 아는 사람은 그 폰에 push를 보낼 수 있다. token은 사용자의 core와 Expo에만 있어 받아들인다. (agent)
- desktop 화면 안 앱 화면(`view_session`)은 `looking`에 싣지 않는다. 이유: 앱이 연 session의 끝은 `unseen`을 세우지 않는다. (agent)
- 기기의 보고는 principal 꼴(`device:`)이 아니라 기기 kind로 폰 규칙과 desktop 규칙을 가른다. 이유: 다른 기계의 desktop도 기기로 붙어 보고하고, 그 사람은 화면 앞에 앉아 있어 desktop처럼 idle 한도를 따라야 한다. kind는 바뀌지 않으므로 보고를 받을 때 한 번 정한다. (planner)

## 열린 것

- 실제 FCM 배달과 Expo token은 확인하지 못했다. 사람의 Expo·Firebase 계정이 있어야 하고, 지금까지는 fake push server가 받은 글로만 확인했다.
- EAS project id가 없는 폰 build는 push token을 받지 못해 알림을 쓸 수 없다. 개발 build만 가짜 token으로 개발 core의 fake push server와 이어진다.
- GUI 탭에서 기다리는 승인은 push 계기가 아니다. 터미널의 TUI는 tracker가 알리지만 GUI의 승인 card는 core의 turn request가 아니다(이슈 `push-misses-gui-tab-approvals`).
- remote를 한 번 켠 뒤 끄면 같은 기동 안에서는 push가 계속 나간다(이슈 `push-continues-after-remote-off`).
- 앱이 session을 멈춘 기록(`session_stopped_by_app`)은 desktop toast에는 뜨지만 push 계기가 아니다. 두 목록이 따로 있다(이슈 `push-alert-program-kinds-differ`).
- 영수증을 기다리는 ticket은 메모리뿐이라 core를 다시 켜면 잃는다. 그 token은 다음 send의 ticket 오류로 알게 된다.
- Android 알림 아이콘이 기본이다(이슈 `phone-notification-icon-default`).
