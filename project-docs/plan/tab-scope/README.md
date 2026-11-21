# tab-scope: 탭 주인과 browser profile

- 목표: 탭마다 주인(사람 또는 session)을 두어 화면이 그것을 그리고 agent가 자기 탭 목록을 읽게 한다. 사람이 쓰던 browser 탭을 agent에게 넘긴다. browser profile을 여럿 두어 agent 정의에 달고, 저장 login이 profile에 속하게 한다.
- 재료: `project-docs/products/roadmap/tab-owner.md`, `project-docs/products/roadmap/browser-profile.md`, `project-docs/architecture/workspace-layout.md`("agent가 연 탭", float, 저장), `project-docs/architecture/browser-tab.md`(모델, 지키는 것 7·34~53), `project-docs/architecture/agent-definition.md`(agent 정의, secret 저장소), 이슈 `agent-browser-page-duplicated-across-windows`.
- 범위 밖: browser profile을 기계 사이에 맞추기(`browser-profile.md` 3단계. 다음 계획), `profile`(avatar) 칸 이름 바꾸기(다른 session의 branch가 많이 돌고 있어 마지막에 따로 한다), 터미널·문서 탭 넘기기, 읽기만 넘기기, 탭을 다른 기계의 session에 넘기기, Agent 탭 저장, 이슈 `workspace-relay-unused-and-disconnected`.

## 정한 것

roadmap의 "정한 것"을 그대로 따른다. 아래는 lead가 구현을 위해 더 정한 것이다.

- **주인은 두 곳에 있고 뜻은 하나다.** 화면은 탭 값(layout)의 주인을 그리고, 권한 판정은 지금처럼 core의 표가 한다. core 표는 메모리 그대로 둔다(이유: 표를 ledger로 옮기면 agent browser 탭의 수명 규칙까지 다시 정해야 한다. `agent-browser-lifetime.md`가 정한 "표가 비면 agent가 다시 연다"를 그대로 둔다). 넘겨받은 탭처럼 core 표가 비어도 화면에 남는 탭은, 창이 core에 다시 붙을 때 주인 있는 탭을 다시 알려 맞춘다.
- **agent가 연 탭의 주인은 연 session, 사람이 연 탭은 주인 칸이 없다**(없음이 사람이다). 옛 layout file은 그대로 읽힌다. layout 판을 올리면 migration을 같이 넣는다.
- **넘기기는 browser 탭만이고 주인이 바뀐다.** 탭의 자리와 key는 그대로다. 넘겨받은 탭은 agent가 닫지 못하고, 사람이 되찾으면 core 표에서 빠진다.
- **팀 tree는 sidebar의 desk 아래에 그린다.** `spawned_by`를 화면이 읽을 길이 없으면 session 목록 계약에 더한다.
- **browser profile의 id와 partition.** 기본 profile은 지금의 `persist:lophn-browser` 그대로다(기존 로그인이 남는다). 새 profile은 partition을 하나씩 갖는다. main이 붙일 때 강제하는 partition 검사는 "알려진 profile의 partition 가운데 하나"로 바꾼다.
- **agent 정의의 칸 이름은 `browser_profile`이다.** 사람만 쓰는 칸이다(`apps`처럼 agent 자격의 입력에 있으면 `forbidden`). 없으면 기본 profile이다.
- **탭의 profile.** agent가 `tab open --url`로 여는 탭은 연 session의 agent 정의의 profile을 쓴다. 사람은 새 browser 탭을 열 때 profile을 고른다. popup은 연 탭을 따른다. 탭 값에 profile을 적어 다시 열어도 같은 profile이다. 탭 머리에 profile이 보인다(기본 profile은 표시하지 않는다).
- **저장 login은 profile에 속한다.** 기존 login은 기본 profile로 옮긴다(data step). `lophn login list`와 `fill-login`은 그 탭의 profile에 든 login만 다룬다.
- **profile을 지우면** 그 partition의 data를 지우고, 그 profile을 쓰던 agent는 기본 profile로 떨어진다.
- **i18n catalog는 wave마다 한 task만 고친다.** 다른 task는 필요한 key를 보고의 "등록할 것"에 적는다.

## task

(계획을 여는 worker가 코드를 읽고 채운다: wave, id, 선행, 한 줄)

## lead가 할 일

- merge마다 `npm run check`. 보고의 "등록할 것"(protocol `mod.ts`, core 조립 목록, gallery `pages/index.ts`, i18n catalog)을 고친다.
- 화면이 바뀌는 task는 merge 전에 gallery page를 직접 찍어 본다. 넘기기와 profile은 land 전에 headless Electron에서 한 번 확인한다.
- 권한 경계(주인 판정, login의 profile 검사, 사람만 쓰는 칸)를 바꾸는 task는 구현하지 않은 worker의 review를 받는다.
- 끝나면: `architecture/workspace-layout.md`("agent가 연 탭"에 주인과 넘기기), `architecture/browser-tab.md`(session 절, 지키는 것 34, site login), `architecture/agent-definition.md`(칸 목록), flows, change-log, 이슈 정리.
