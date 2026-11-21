# browser profile: 로그인 신원을 나누고 agent에 단다

상태: 로드맵 초안. 2026-11-21 사람이 방향을 냈고 planner가 썼다. 정할 것은 모두 정했다(2026-11-21). 사람의 검수 전이다. `(agent)`로 적은 것은 planner가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/architecture/{browser-tab,agent-definition,folder-sync,machine,remote}.md`, `project-docs/products/roadmap/{agent-browser-lifetime,browser-tab,tab-owner,agent-profile,multi-machine}.md`.
조사: harness-lab `_report/browser-use/`, `_report/browser-vault/`, `_report/multi-device/comparison.md`.

## 사람의 말 (원문)

2026-11-21:

> browse 프로필 또한 분리하고 agent마다 할당하고 다른 머신과의 동기화

> agent profile은 무조건적인 동기화는 안 함, 환경이 다르고 지침이 다르고 암튼 다름

## 왜

- 사람과 모든 agent가 cookie와 로그인을 하나로 같이 쓴다. 업무 계정과 개인 계정을 가를 수 없고, page 글에 속은 agent가 사람의 모든 로그인에 닿는다.
- 로그인은 기계마다 따로 해야 한다. 저장 login도 기계를 건너지 않는다.

## 지금 코드

- **partition이 하나다.** `BROWSER_PARTITION = "persist:lophn-browser"`(`packages/shell/main/browser/session.ts:7`). renderer도 같은 글을 든다(`packages/shell/renderer/app-frame/webview-host.tsx:31`). main이 `<webview>`를 붙일 때 이 partition을 강제하고(`packages/shell/main/browser/webview-guest.ts:69-73`), 화면 없는 기계의 page host도 같은 것을 쓴다(`packages/shell/main/page-host/pages.ts:41`).
- **자리**는 `<data>/shell/browser`다(`packages/shell/main/desktop/paths.ts:46`).
- **저장 login은 전역 하나다.** metadata `{id: lgn_, label, origin, username, note}`는 `logins.json`, 값은 `secrets.json`이다(`packages/core/secrets/logins.ts`, `packages/protocol/secrets/logins.ts`). 주인이 없다. 근거는 "cookie partition이 이미 전역이라 나눠도 막는 것이 없다"였다(`architecture/browser-tab.md` 44).
- **profile이라는 물건이 없다.** Settings › Browser(`packages/shell/renderer/desktop/settings/browser/`)는 Links, Logins, 데이터 지우기다. 지우기는 partition 전부를 지운다.
- **agent를 막는 것**: 자기가 연 탭만 다루기, page 글을 untrusted로 감싸기, 사람의 Take control, 결과에서 알려진 값 가리기, 비밀번호는 handle로만 채우기(`architecture/browser-tab.md` 34~50). 승인, site 목록, cookie 격리는 비목표다.
- **agent page의 상한**은 창마다 12개다(`MAX_AGENT_PAGES`, `packages/shell/renderer/app-frame/workspace-views.tsx:29`).
- **기계 사이.** browser 관련해 맞추는 것이 없다. page는 agent가 도는 기계에 살고 사람은 다른 기기에서 멀리서 본다(`architecture/browser-tab.md` "멀리서 보기"). 기기 route에서 `logins/*`와 `tabs/*`는 뺐다(`packages/protocol/remote/allowlist.ts`).
- **이미 정한 것**
  - agent 탭은 사람 탭과 같은 partition을 쓴다(사람, 2026-11-09).
  - 무인 job도 사람의 로그인을 쓴다(사람, 2026-11-10).
  - 사람의 Chrome profile에서 cookie를 가져오지 않는다(`agent-browser-lifetime.md` "하지 않는 것").
  - provider key, secret, git token을 기계 사이에 맞추지 않는다(`multi-machine.md` "하지 않는 것").

## 다른 harness

| 방식 | 제품 | 내용 |
|---|---|---|
| 공유 하나 | Paseo, GooeyPi, Codex | Paseo는 탭마다 나누던 partition을 걷어내는 중이다 |
| session이나 탭마다 임시 | OpenCode, Claude desktop 기본, T3 Code | 닫으면 사라진다 |
| 이름 있는 profile 여럿 | Orca, T3 Code, Hermes | 아래 |

- **Orca**: profile을 만들고 복제하고 지운다. 종류는 default, isolated, imported다. 새 탭의 범위를 shared, repo, worktree에서 고르고, 탭마다 profile을 바꾸고, host마다 기본 profile을 둔다.
- **T3 Code**: 영속 profile과 탭마다 버려지는 격리 context를 같이 둔다.
- **Hermes**: profile이 agent의 집 전체라 browser profile이 agent에 딸려 온다. 복제할 때 자격은 뺀다.
- **Claude desktop**: 저장 방식을 shared, session, none에서 고르고 기본이 none이다.

기계 사이: 조사한 13개 제품 가운데 browser 상태를 맞추는 곳은 없다. 자격을 옮기는 길을 낸 곳(OpenCode, omp, Hermes backup)은 평문이고, 돌려 쓰는 token 때문에 사본이 서로를 logout시킨 사례가 있다. Paseo, Orca, T3 Code는 browser를 사람이 앉은 기계에 두고 다른 host의 agent가 명령을 그쪽으로 보낸다.

## 무엇을 만드나

### profile

- profile 하나는 partition 하나와 그 profile의 저장 login이다. 이름과 색이 있다.
- 기본 profile이 하나 있다. 지금의 `persist:lophn-browser`가 그것이라 기존 로그인이 그대로 남는다.
- bookmark는 전역으로 둔다.
- popup은 연 탭의 profile을 따른다.
- 데이터 지우기는 profile마다 한다.
- 화면 없는 기계의 page host도 같은 profile을 쓴다.

### 다는 자리

- agent 정의에 profile 칸이 있다. 없으면 기본 profile이다. agent가 여는 탭은 그 profile을 쓴다.
- 사람은 새 탭을 열 때 profile을 고른다. 탭 머리에 profile이 보인다.
- 넘긴 탭은 자기 profile을 그대로 든다. 격리된 agent에게 사람 profile의 탭 하나만 빌려줄 수 있다(`tab-owner.md`).

### 화면

- Settings › Browser › Profiles: 만들기, 이름과 색, 지우기(데이터 삭제), 그 profile을 쓰는 agent 목록.
- Logins는 profile마다 나뉜다.

### 저장 login

- 저장 login은 profile에 속한다. 기존 login은 기본 profile로 옮긴다(data step).
- agent는 자기 탭의 profile에 든 login만 목록으로 보고 채운다.

### 기계 사이

- profile 정의(이름, 색)와 저장 login이 folder-sync의 길로 다른 기계에 간다.
- cookie와 저장소는 기계마다 따로다. 다른 기계에서는 agent가 저장 login으로 다시 로그인하거나, 사람이 멀리서 보며 한 번 로그인한다.
- 어느 agent에 어느 profile을 다는지는 기계마다 따로다.

## 정한 것

1. browser profile을 나누고 agent마다 단다. (사람, 2026-11-21) "agent 탭은 사람 탭과 같은 partition"(사람, 2026-11-09)을 고친다.
2. 어느 agent에 어느 profile을 다는지는 기계마다 따로다. (사람, 2026-11-21 "agent profile은 무조건적인 동기화는 안 함"의 적용)
3. 저장 login은 profile에 속한다. (agent: 전역 하나였던 근거가 "partition이 전역이라"였다)
4. 정의에 profile을 적지 않은 agent는 기본 profile(사람 것)을 쓴다. (agent: 2026-11-09·10에 사람이 정한 것이 적지 않은 agent에 그대로 서고, 지금 도는 job이 그대로 돈다. 가르고 싶은 agent에만 profile을 단다)
5. profile을 다는 자리는 agent 정의다. 사람은 새 탭에서 고른다. agent가 탭마다 다른 profile을 고르는 길은 요구가 생기면 한다. (agent: 사람이 "agent마다 할당"이라고 했다)
6. profile을 지우면 그 profile을 쓰던 agent는 기본 profile로 떨어지고 편집기에 표시된다. (agent)
7. **기계 사이에 profile 정의(이름, 색)와 저장 login을 맞춘다.** cookie와 저장소는 맞추지 않는다. 다른 기계에서는 agent가 저장 login으로 다시 로그인하거나 사람이 한 번 로그인한다. (사람, 2026-11-21) `multi-machine.md`의 "secret을 기계 사이에 맞추지 않는다"를 site login에 한해 고친다. provider key와 git token은 그대로 맞추지 않는다.

## 정할 것

없다.

## 단계

| 단계 | 하는 일 |
|---|---|
| 1 | profile: partition 여럿, Settings, 탭의 profile 표시, agent 정의의 칸, 탭을 열 때 고르기 |
| 2 | 저장 login을 profile로 |
| 3 | 기계 사이: profile 정의와 저장 login |

1 → 2 → 3은 차례다. 1은 `agent-profile.md`의 "무엇을 보나"와 같이 간다.

## 하지 않는 것

- site 허용 목록, capability별 승인(`browser-tab.md` 비목표 그대로).
- 사람의 Chrome profile에서 cookie 가져오기.
- cookie와 저장소를 기계 사이에 맞추기.
- 다른 기계의 browser를 agent가 멀리서 쓰기.
- agent 정의를 기계 사이에 맞추기.
- 방문 기록, bookmark를 profile마다 나누기.

## 확인하지 않은 것

- Electron에서 persist partition을 여럿 둘 때의 디스크와 메모리.
- 화면 없는 page host가 partition 여럿을 같이 쓰는지.
- 저장 login으로 다시 로그인할 때 site가 새 기기 확인을 요구하는 빈도.
