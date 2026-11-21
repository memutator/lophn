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
- **저장 login은 profile에 속한다.** `profile` 칸이 없는 login은 기본 profile의 것이라 기존 login은 그대로 기본 profile에 선다(data step 없음. 탭 값과 정의의 칸이 "없으면 기본"인 것과 같은 규칙). `lophn login list`와 `fill-login`은 그 탭의 profile에 든 login만 다룬다.
- **browser 탭이 아닌 탭(preview, artifact, phone)의 저장 login은 기본 profile의 것이다.** 그 탭에서는 자기 profile이 기본인 쪽(사람, profile을 달지 않은 agent)만 login을 보고 채운다. profile을 단 agent는 그 탭에서 목록이 비고 채우기가 없는 login처럼 답한다. 이유: 그 page의 partition은 browser profile이 아니라서 다른 profile의 login을 내줄 근거가 없고, 기본으로 풀면 profile을 단 agent가 자기 artifact 탭으로 사람의 login 목록을 읽는다(`browser-profile-core`의 독립 review가 찾음). (lead, 2026-11-21)
- **profile을 읽지 못하면 기본으로 떨어지지 않는다.** ledger나 agent 정의를 읽지 못하면 탭 열기와 login 목록은 `unavailable`이다. 기본 profile이 되는 것은 정의에 profile이 없을 때와, 적힌 profile이 설정에서 지워졌을 때 둘뿐이다. (lead, 2026-11-21)
- **profile을 지우면** 그 partition의 data와 그 profile의 저장 login을 지우고(확인 dialog가 지울 login 수를 말한다), 그 profile을 쓰던 agent는 기본 profile로 떨어진다.
- **profile id는 `bpf_<ULID>`다.** 꼴은 `idSchema("bpf")`(protocol base)이고, 목록·partition 규칙은 `packages/protocol/shell/browser-profiles.ts`다. `protocol/lophn-agent`와 `protocol/secrets`는 그 file을 import하지 않는다(protocol-cycle).
- **i18n catalog는 wave마다 한 task만 고친다.** 다른 task는 필요한 key를 보고의 "등록할 것"에 적는다.

## task

| wave | id | 선행 | 한 줄 | worker |
|---|---|---|---|---|
| 1 | `tab-owner-core` | 없음 | core 탭 표: `tab_open`의 `owner`, `tabs/list`·`lophn tab list`(coordinator는 자기 밑까지), `tabs/hand`, 넘겨받은 탭은 agent가 못 닫음 | opus-high |
| 1 | `tab-owner-layout` | 없음 | 탭 공통 칸 `owner`·`handed_tab`, layout 판 12·전역 float 판 4와 data step `shell.layout-owners`, renderer `TabItem`·`hostTabOf()` | opus-high |
| 1 | `browser-profile-partitions` | 없음 | profile마다 partition: main 붙이기 검사·session 정책·driver·page host·profile마다 데이터 지우기, renderer `<webview>` partition, 탭에서 연 탭·popup이 profile을 따름, `useBrowserProfiles()` | opus-high |
| 2 | `tab-owner-screen` | tab-owner-core, tab-owner-layout, browser-profile-partitions | 열린 탭에 주인 적기, 탭 줄·칸 머리·float bar·detached·전역 float의 주인 avatar, 주인마다 chip, "{name} is controlling", profile 표시와 새 탭의 profile 고르기 | opus-high |
| 2 | `tab-owner-sidebar` | tab-owner-layout | snapshot·`SessionStarted`에 `spawned_by`, sidebar 팀 tree와 session 줄을 펴면 그 session의 탭 | opus-high |
| 2 | `browser-profile-core` | tab-owner-core, browser-profile-partitions | 설정 `shell.browser_profiles`, 정의 칸 `browser_profile`(사람만), `tab open --url`의 profile, login의 profile(선택 칸, data step 없음), list·fill·release·저장 요청의 profile 검사 | opus-high |
| 3 | `tab-owner-hand` | tab-owner-core, tab-owner-screen, tab-owner-sidebar | 사람이 browser 탭을 session에 넘기기(session 줄·주인 chip에 끌기, Hand to)와 Take back, 넘긴 탭의 page·bind·상태, core에 다시 붙을 때 다시 알리기 | opus-high |
| 3 | `browser-profile-settings` | browser-profile-core, browser-profile-partitions | Settings › Browser › Profiles(만들기·이름·색·데이터 지우기·지우기·쓰는 agent), profile마다 Logins, agent 편집기의 Browser profile 칸과 card 표시 | sonnet-high |

lead가 wave를 열기 전에 commit하는 계약(모양은 brief의 "계약"):

- wave 1 전: `packages/protocol/base/ids.ts`의 `bpf`, 새 file `packages/protocol/shell/browser-profiles.ts`(`browser-profile-partitions` brief), `packages/protocol/lophn-agent/host-queue.ts`의 `tabOpenPayloadSchema.owner?`와 host target browser 갈래의 `profile?`(`tab-owner-core` brief). 둘 다 선택 칸이라 지금 코드가 그대로 type check를 지난다.
- wave 2 전: catalog `left-sidebar.ts`에 `left-sidebar.button.session-tabs-show`·`-hide`(`tab-owner-sidebar` brief). 이 wave의 catalog는 `tab-owner-screen`이 고친다.
- wave 3 전: catalog `shell.ts`에 `shell.button.tab-hand`, `shell.button.tab-take-back`, `shell.text.tab-hand-none`, `shell.toast.tab-hand-failed`(`tab-owner-hand` brief). 이 wave의 catalog는 `browser-profile-settings`가 고친다.

data step은 `shell.layout-owners` 하나이고 `tab-owner-layout`이 자기 wiring(`shell-agent-tabs.ts`)의 `dataSteps`에 직접 단다. 판을 올리는 commit과 step이 떨어지면 사람의 layout을 읽지 못한다. `WIRINGS`(assembly)는 바뀌지 않는다.
같은 wave의 두 task가 `project-docs/flows/tests/`의 같은 group file(`core-rest.yaml`, `shell.yaml`)에 `covers` 줄을 더할 수 있다. 소유에 두지 않았고, 부딪치면 lead가 rebase 때 두 쪽을 다 남긴다.

## 알고 가는 한계

- core는 도는데 shell main의 host link만 끊겼다 붙으면(창의 core 연결은 그대로) 넘긴 탭이 core 표에서 빠진 채 남는다. 그 탭을 다시 넘기거나 창을 다시 열면 맞는다. 드물어서 장치를 두지 않는다.
- mount하지 않은 workspace의 넘긴 탭은 그 workspace를 열 때 core 표에 다시 오른다.
- core는 다시 알리는 `tabs/hand {tab}`을 창이 보낸 대로 믿는다(표가 빈 뒤에는 어느 id든 넘긴 탭이 된다). 창이 `handedTab`이 있는 탭만 다시 알리는 것이 그 검사다(`tab-owner-hand`). 사람 자격의 route라 다른 사람 route와 같은 신뢰다.
- coordinator가 자기 탭을 자식에게 넘기는 길(roadmap "넘기기")은 이 계획에 없다. 다음에 한다.
- "Hand to"의 상대는 lophn session뿐이다. coding agent GUI 탭이 팀 member가 되면(`a2a-access.md`) 그때 상대에 든다.

## lead가 할 일

- merge마다 `npm run check`. 보고의 "등록할 것"(protocol `mod.ts`, core 조립 목록, gallery `pages/index.ts`, i18n catalog)을 고친다.
- 화면이 바뀌는 task는 merge 전에 gallery page를 직접 찍어 본다. 넘기기와 profile은 land 전에 headless Electron에서 한 번 확인한다.
- 권한 경계(주인 판정, login의 profile 검사, 사람만 쓰는 칸)를 바꾸는 task는 구현하지 않은 worker의 review를 받는다.
- 끝나면: `architecture/workspace-layout.md`("agent가 연 탭"에 주인과 넘기기), `architecture/browser-tab.md`(session 절, 지키는 것 34, site login), `architecture/agent-definition.md`(칸 목록), flows, change-log, 이슈 정리.
