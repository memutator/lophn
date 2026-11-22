# browser profile: 로그인 신원을 기계 사이에 잇는다

상태: 1·2단계(profile마다 partition, Settings › Browser › Profiles, 탭의 profile 표시와 새 탭에서 고르기, agent 정의의 `browser_profile`, 저장 login을 profile로)는 계획 tab-scope로, 3단계(기계 사이에 profile 정의와 저장 login을 맞추기)는 browser-profile-sync로 만들었다(change-log `tab-scope`, `browser-profile-sync`). 지금 설계는 `project-docs/architecture/browser-tab.md`의 "browser profile", "site login", "기계 사이"와 `project-docs/architecture/agent-definition.md`의 `browser_profile`이다. 계획으로 열 남은 일은 없다. 이 문서에는 정한 것, 하지 않는 것, 확인하지 않은 것만 둔다.

## 사람의 말 (원문)

2026-11-21:

> browse 프로필 또한 분리하고 agent마다 할당하고 다른 머신과의 동기화

> agent profile은 무조건적인 동기화는 안 함, 환경이 다르고 지침이 다르고 암튼 다름

## 정한 것

1. 어느 agent에 어느 profile을 다는지는 기계마다 따로다. (사람, 2026-11-21 "agent profile은 무조건적인 동기화는 안 함"의 적용)
2. 기계 사이에 profile 정의(이름, 색)와 저장 login(값 포함)을 맞춘다. cookie와 저장소는 맞추지 않는다. 다른 기계에서는 agent가 저장 login으로 다시 로그인하거나 사람이 한 번 로그인한다. `multi-machine.md`의 "자격은 기계를 넘지 않는다"를 site login에 한해 고쳤다. provider key와 git token은 그대로 맞추지 않는다. (사람, 2026-11-21)
3. 길은 folder-sync가 아니라 명단의 컴퓨터 사이 link 하나다. 이유: 같이 보는 폴더는 cloud에 평문으로 올라갈 수 있고, 이미 있는 길 가운데 두 core 사이가 끝에서 끝까지 암호화된 것은 link(Noise)뿐이다. origin과 username도 폴더에 두지 않는다. 대가는 두 컴퓨터가 같은 때 켜져 있어야 맞춰진다는 것이다. (lead·agent, 2026-11-22)
4. profile 목록은 설정에서 저장 login과 같은 vault file로 옮겼다(칸마다 stamp와 지운 것의 흔적이 있어야 합친다). (agent, 2026-11-22)

## 하지 않는 것

- cookie와 저장소를 기계 사이에 맞추기.
- 다른 기계의 browser를 agent가 멀리서 쓰기.
- agent 정의를 기계 사이에 맞추기.
- 사람의 Chrome profile에서 cookie 가져오기.
- 방문 기록, bookmark를 profile마다 나누기.
- 같이 켜지지 않는 컴퓨터(dual boot 등)를 위해 받는 컴퓨터의 key로 암호화한 vault를 폴더로 보내기. 새 암호 code가 필요하고 cloud에 남은 옛 사본이 뒤에 열릴 수 있어서다. 사람이 그 경우를 말하면 다시 본다.

## 확인하지 않은 것

- 저장 login으로 다시 로그인할 때 site가 새 기기 확인을 요구하는 빈도.
- 서로 다른 실제 컴퓨터와 relay 길에서의 맞추기(한 기계의 개발 core 둘로만 보았다).
