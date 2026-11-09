# browser-vault

- 목표: 사람이 넣은 site login을 agent가 handle로 browser 탭에 채우게 하고(model은 값을 보지 않는다), agent가 사람에게 login·일회 코드 입력을 요청하게 한다. Home memory를 모든 workspace의 agent가 받는 전역 memory로 올린다.
- 재료: `project-docs/products/roadmap/browser-vault.md`, `project-docs/architecture/agent-definition.md`(memory, secret 저장소), `project-docs/architecture/browser-tab.md`("agent가 다루는 browser 탭"), `harness-lab/_report/browser-vault/README.md` §6~7, `harness-lab/_report/browser-vault/hermes.md` §4~6
- 범위 밖: roadmap "하지 않는 것"

## 정한 것

전역 memory:
- **Home memory가 전역 memory다.** 새 파일을 두지 않는다. `<data>/home/memory.md`를 모든 workspace의 lophn·사람이 만든 agent가 `global memory` 출처로 받는다. Home session에서는 같은 파일이라 한 번만(`global memory`) 싣는다. bare는 받지 않는다(workspace memory와 같다). 순서는 global → workspace → agent. (agent: 새 층과 자리 입력 없이 주입만 바뀐다)
- **쓰는 것은 Home lophn과 사람뿐이다.** project·앱 lophn은 Home lophn을 부를 수 없다(`router.ts`가 handle `lophn`을 부른 쪽 workspace로 보낸다, `agent-call.md` "Home lophn은 Home에서 보낸 call이나 사람·program의 call로만 닿는다"). 이 경계는 그대로 두고, project·app prompt의 "Home lophn에 물어라" 줄(지금 자기 lophn으로 가는 bug)을 "전역 사실은 global memory에 있다. 없으면 사람에게 묻는다"로 고친다. (agent: 한 workspace에서 속은 agent가 모든 prompt에 글을 넣는 길을 만들지 않는다)
- 크기는 그대로 8 KiB, session 첫 turn 고정도 그대로다. (agent)

login 저장과 채우기:
- **값은 `secrets.json`, metadata는 `<data>/logins.json`(0600)이다.** 항목 `{id: "lgn_…", label, origin, username, note}`. 값 이름은 `login.<id>.password`, `login.<id>.totp`(TOTP seed). 저장된 값은 이미 모두 known-value redaction에 오른다. 새 파일이라 data step이 없다(없으면 빈 목록). (agent)
- **login은 전역 하나다.** 소유자(workspace, agent)를 두지 않는다. cookie partition이 이미 전역이라 나눠도 막는 것이 없다. (agent)
- **origin은 정확히 일치할 때만 값을 내준다.** scheme·host·port가 같아야 한다. 와일드카드·상위 도메인 없음. 비교는 core가 하고, 비교할 origin은 shell main이 그 ref 요소가 든 frame의 실제 origin으로 잰다(최상위 URL이 아니다). 치는 동안 그 frame이 이동하면 멈춘다. (agent, Hermes 방식)
- **값은 shell main만 받는다.** 새 core route는 shell capability로만 부른다(HTTP user token, agent·worker credential, CLI는 못 부른다). host queue의 `browser_call`과 ledger에는 login id만 있고 값은 없다. TOTP는 core가 code를 만들어 내준다. (agent: `apps.secret_value`가 supervisor만 부르는 것과 같은 모양)
- **model이 보는 것**: `lophn login list [--origin]`의 id, label, origin, username, note, TOTP 유무. 값은 어디에도 없다. (agent)
- **snapshot은 `type=password` 칸의 value를 찍지 않는다.** `evaluate`와 screenshot은 막지 않는다. browser 결과가 caller에 가기 전에 core의 known-value redaction을 거치게 한다(지금 거치지 않으면 더한다). (agent: AGENTS.md "속도". 탭 주인 제한, untrusted 감싸기, take control이 그대로 있다)
- `secrets.json` 암호화는 하지 않는다. 같은 사용자의 process에는 파일 키(Hermes·Skyvern 기본값)도 막지 못한다. (agent)

agent의 입력 요청:
- **agent는 보호 입력 창을 직접 열지 못한다.** 요청은 대화에 card로 뜨고 사람이 눌러야 창이 열린다(지금 "창은 사람의 클릭으로만" 규칙 유지). 요청은 session당 하나다(`ask`와 같은 대기열). (agent)
- **창이 보이는 origin은 shell main이 탭에서 잰다.** agent가 적은 글이 아니다. 피싱 site에 넣게 속은 요청을 사람이 origin으로 거른다. (agent)
- **두 갈래**: 저장(label, username, password, 선택 TOTP → 새 login, agent는 login id를 받는다)과 한 번 넣기(값 하나를 그 ref에 바로 치고 버린다. agent는 `filled`만 받는다. 친 값은 그 session이 끝날 때까지 known-value로 등록한다). (agent)
- memory 안내: login 목록은 계산되므로 memory에 옮기지 않는다. "이 일은 이 login"이라는 선택만 workspace memory(또는 Home이면 global memory)에 적는다. 후보가 하나면 묻지도 적지도 않는다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `gmem` | 없음 | Home memory를 전역으로 주입, prompt·Agents 탭 문구, 문서 |
| 1 | `vault-core` | 없음 | `logins.json` store, login route(list·save·delete·release), `lophn login list` |
| 2 | `vault-fill` | `vault-core` | `browser act fill_login`, frame origin 확인, snapshot password 가리기, browser 결과 redaction, agent 안내 |
| 2 | `vault-ui` | `vault-core` | Settings › Browser › Logins, 보호 입력 창 purpose `login` |
| 3 | `vault-request` | `vault-fill`, `vault-ui` | agent의 login·일회 입력 요청(card → 보호 창 → 저장 또는 바로 치기) |

## 위험 test (task brief에 있다)

- 다른 origin이면 release가 값을 내주지 않는다.
- shell capability가 아닌 자격은 release를 부르지 못한다.
- `logins/list`와 ledger에 값이 없다.

## lead가 할 일

- merge마다 `npm run check`. flows는 각 task가 자기 명령·route를 고친다.
- `gmem`이 `app.md`(앱 agent가 읽는 지침)를 바꾸므로 `sdk-note` 메모가 그 task에 있다.
- 끝나면: `architecture/browser-tab.md`에 login 채우기·요청 절, `agent-definition.md` secret 저장소 절에 `login.` 이름 공간, change-log, roadmap `browser-vault.md` 지우기.
- 사람에게: 끝난 뒤 Electron에서 실제 site 로그인 한 번(저장 → list → fill_login → 2FA 한 번 넣기) 확인을 부탁한다.
