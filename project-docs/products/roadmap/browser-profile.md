# browser profile: 로그인 신원을 기계 사이에 잇는다

상태: 1·2단계(profile마다 partition, Settings › Browser › Profiles, 탭의 profile 표시와 새 탭에서 고르기, agent 정의의 `browser_profile`, 저장 login을 profile로)는 계획 tab-scope로 만들었다(change-log `tab-scope`). 지금 설계는 `project-docs/architecture/browser-tab.md`의 "browser profile"과 "site login", `project-docs/architecture/agent-definition.md`의 `browser_profile`이다. 이 문서에는 남은 3단계(기계 사이)만 둔다.
배경 문서: `project-docs/architecture/{browser-tab,agent-definition,folder-sync,machine,remote}.md`, `project-docs/products/roadmap/{multi-machine,agent-profile}.md`.
조사: harness-lab `_report/browser-vault/`, `_report/multi-device/comparison.md`.

## 사람의 말 (원문)

2026-11-21:

> browse 프로필 또한 분리하고 agent마다 할당하고 다른 머신과의 동기화

> agent profile은 무조건적인 동기화는 안 함, 환경이 다르고 지침이 다르고 암튼 다름

## 왜

- 로그인은 기계마다 따로 해야 한다. profile 목록과 저장 login도 기계를 건너지 않는다.

## 지금 코드

- profile 목록은 기계마다의 설정 `shell.browser_profiles`(locked)이고 저장 login은 기계마다의 `<data>/logins.json`(항목의 `profile`)과 `secrets.json`이다. 기계 사이에 맞추는 것이 없다.
- 기기 route에서 `logins/*`와 `tabs/*`는 뺐다(`packages/protocol/remote/allowlist.ts`).

## 다른 harness

조사한 13개 제품 가운데 browser 상태를 맞추는 곳은 없다. 자격을 옮기는 길을 낸 곳(OpenCode, omp, Hermes backup)은 평문이고, 돌려 쓰는 token 때문에 사본이 서로를 logout시킨 사례가 있다. Paseo, Orca, T3 Code는 browser를 사람이 앉은 기계에 두고 다른 host의 agent가 명령을 그쪽으로 보낸다.

## 무엇을 만드나

- profile 정의(이름, 색)와 저장 login이 folder-sync의 길로 다른 기계에 간다.
- cookie와 저장소는 기계마다 따로다. 다른 기계에서는 agent가 저장 login으로 다시 로그인하거나, 사람이 멀리서 보며 한 번 로그인한다.
- 어느 agent에 어느 profile을 다는지는 기계마다 따로다.

## 정한 것

1. 어느 agent에 어느 profile을 다는지는 기계마다 따로다. (사람, 2026-11-21 "agent profile은 무조건적인 동기화는 안 함"의 적용)
2. **기계 사이에 profile 정의(이름, 색)와 저장 login을 맞춘다.** cookie와 저장소는 맞추지 않는다. 다른 기계에서는 agent가 저장 login으로 다시 로그인하거나 사람이 한 번 로그인한다. (사람, 2026-11-21) `multi-machine.md`의 "secret을 기계 사이에 맞추지 않는다"를 site login에 한해 고친다. provider key와 git token은 그대로 맞추지 않는다.
3. profile 목록을 설정에 둔 자리(`shell.browser_profiles`)는 맞출 때 다시 본다. (agent, tab-scope)

## 하지 않는 것

- cookie와 저장소를 기계 사이에 맞추기.
- 다른 기계의 browser를 agent가 멀리서 쓰기.
- agent 정의를 기계 사이에 맞추기.
- 사람의 Chrome profile에서 cookie 가져오기.
- 방문 기록, bookmark를 profile마다 나누기.

## 확인하지 않은 것

- 저장 login으로 다시 로그인할 때 site가 새 기기 확인을 요구하는 빈도.
