# secret request: agent가 secret이 필요한 자리를 가리켜 사람에게 넣어 달라고 한다

상태: 방향을 정했다. 2026-11-11 사람이 방향을 냈고 planner가 정리했다. 사람이 정할 것 둘이 남아 있고 추천안으로 적었다. 일은 아직 시작하지 않았다.
선행: 계획 `browser-vault`가 main에 올라와야 한다(`lophn login request`가 이 roadmap의 재료다).
배경 문서: `project-docs/products/roadmap/config-surface.md`(설정은 agent가 바로 바꾼다. secret과 provider 연결은 뺐다), `browser-vault.md`, `project-docs/architecture/agent-definition.md`(secret 저장소), `browser-tab.md`(login 요청), `approval.md`, `app-call.md`.

## 사람의 말 (원문)

2026-11-11, `lophn login request`가 site login 전용이라는 답을 듣고:

> 근데 그게 우리 앱에서 secreet을 쓰는 곳에다 쓸 수 있는 게 아니란거지?

> project-docs/products/roadmap/config-surface.md 이거 읽어와봐 우리 설정에서도 provider key 관련해서나 app에서도 좀 더 lophn agent가 범용적으로 쓰게끔 후속 roadmap 너가 열어줘

## 왜

- `config-surface`가 서면 agent는 설정을 `lophn settings set`으로 바로 바꾼다. 그런데 secret이 걸린 일은 거기서 뺐다(정한 것 3). 그래서 "Anthropic 연결해 줘", "이 앱에 Notion 붙여 줘"는 여전히 agent가 "Settings › Providers에 가서 넣으세요"라고 글로 안내하는 데서 끝난다.
- 앱을 짓는 agent가 가장 자주 막힌다. `secret.use`를 선언하고 나면 값이 있어야 앱을 돌려 볼 수 있는데, 지금 지침은 "앱의 Access 탭에서 넣으라고 말해라"다. 사람은 대화를 떠나 앱 상세 › Access를 찾아가 넣고 돌아와 "넣었어"라고 말해야 한다.
- `browser-vault`가 그 길의 뼈대를 이미 만들었다: agent가 요청한다 → 대화에 card가 뜬다 → 사람이 눌러야 보호 입력 창이 열린다 → agent는 결과만 받는다. 값은 model에 가지 않는다. 다만 browser 탭의 입력 칸 전용이다.
- 이 roadmap은 그 뼈대를 "secret이 들어가는 자리" 전체로 넓힌다. 값이 보호 창으로만 들어간다는 것과 agent가 창을 직접 열지 못한다는 것은 그대로다.

## 지금 코드 (main `ee98de848` 0.23.30, login 요청은 branch `plan/browser-vault` `d33b74e8d`)

### secret을 넣는 길은 화면뿐이다

- `secrets/put`·`secrets/delete`는 actor `user`만 받는다(`packages/protocol/secrets/secret-file.ts:51,62`). `secrets/status`는 사람이 아니면 빈 목록을 준다.
- 보호 입력 창을 여는 곳은 모두 `enterSecret()`(`packages/shell/renderer/desktop/settings/core-call.ts:65`)을 지난다. purpose는 `app`, `provider`, `mcp`이고 branch에서 `login`이 더해진다(`packages/shell/ipc/secret-input.ts:20`).

| 자리 | 여는 화면 | secret 이름 | `stored` 뒤 |
|---|---|---|---|
| provider key | Settings › Providers의 connect(`providers/core-source.ts:245`) | `provider.<id>` | `connectProvider`. 실패하면 secret을 지운다 |
| 앱 secret | 앱 상세 › Access의 [Set value](`app-detail/core-source.ts:807`) | 앱이 선언한 이름 그대로(`gdrive`) | 다시 읽기만 한다 |
| 앱 OAuth client secret | 같은 탭(`:822`) | `app-oauth.<name>.client` | sign-in은 따로 누른다 |
| MCP server | Settings › Agents와 agent 편집기에서 server를 만들 때만(`settings/agents/core-source.ts:407`, `workspace/agents/core-source.ts:365`) | `mcp.<global\|agt id>.<server>`, `.client` | 없다 |

- MCP는 이미 있는 server의 값을 바꾸는 길이 사람에게도 없다(여는 곳이 만들 때 둘뿐이다). server 설정을 먼저 저장하므로 창을 닫으면 값 없는 server가 남는다.
- 앱 secret 이름은 prefix가 없고 전역이다. 같은 이름을 선언한 앱은 값을 같이 쓴다(`architecture/app-call.md`).

### provider 연결

- route는 `providers/connect`·`disconnect`·`refresh-models`·`login-begin`·`login-complete`·`login-cancel`이 actor `user`만 받고, `providers/read`·`list`·`definitions`는 agent도 읽는다(`packages/protocol/lophn-agent/providers.ts`).
- key 연결은 definition에서 endpoint와 protocol을 가져온다. Custom은 사람이 base URL과 protocol을 넣는다. 구독 sign-in(ChatGPT, SuperGrok, Claude, Antigravity)은 OS browser를 열고 core가 token을 `provider.<id>(.refresh|.meta)`에 둔다.
- `ConnectProvider`는 그 provider 몫의 이름(`provider.<id>`)만 받는다. 다른 이름을 가리킬 수 있으면 앱·MCP secret이 provider endpoint로 나가기 때문이다(`architecture/agent-definition.md`).
- provider를 다루는 CLI 명령과 agent tool은 없다.
- key가 없거나 거절되면 turn이 `configuration_unavailable`로 멈추고 대화에 "Check the model below, or Settings → Providers."라는 글과 retry만 뜬다(`packages/shell/renderer/conversation/thread/provider-error.tsx:40`). 창으로 가는 button은 없다.

### 앱과 MCP가 "값이 없다"를 알리는 길

- 앱: 값이 없으면 `createFileSecretAttach`(`packages/core/secrets/file-attach.ts`)가 `not_found`를 넘긴다. 앱의 `CapabilityError`에 "값을 넣어야 한다"는 표시는 따로 없다(OAuth의 `conflict` "sign-in required"만 있다). 앱까지 어떤 code로 닿는지는 계획에서 확인한다.
- MCP: 연결 상태 `failed_auth`와 `agent-mcp-tools/list`의 `reason: sign_in`이 있지만 Grants 화면용이다. 사람에게 뜨는 요청은 없다.
- OAuth sign-in을 시작하는 route(`apps/oauth_*`, `agent-mcp-auth/*`, provider `login-*`)는 모두 사람이 화면에서 누른다.

### agent에게 준 지침은 "묻지 마라"뿐이다

- 공통 prompt: "Never ask for, reveal or guess secrets, tokens or credentials."(`packages/core/agent-workspaces/prompts/prompts.ts:51`)
- 앱 prompt: "The person sets the value … on the app's Access tab; tell them what to set there. Never ask for the value in the conversation."(`prompts/app.md:88-91`)
- `lophn`과 `ask` tool은 home, project, app agent가 모두 갖는다(`packages/protocol/lophn-agent/tool-lists.ts`).

### login 요청에서 다시 쓸 수 있는 것 (branch)

- **대기열**: `ask`와 같은 session당 하나짜리 대기열을 쓴다(`packages/core/lophn-agent/tools/questions/wait.ts`의 `askLogin`·`readLogin`·`finishLogin`). 취소, turn 끝, 사람의 새 message는 `cancelled`다. 사람이 없는 turn이면 바로 `unattended`다.
- **card → 창**: card는 `{session, tool_call}`만 창에 넘기고, 무엇을 받을지는 shell main이 core에서 다시 읽는다(`packages/shell/main/secret-input/request.ts`). renderer가 준 글을 믿지 않는다.
- **부를 수 있는 쪽**: `agent:<session>` credential이면 home, project, app 어디서든 부른다. 터미널의 coding agent도 `lophn-agent` skill로 같은 명령을 쓴다.
- **login에 묶인 것**: protocol의 `tab`·`ref`·`mode`·`origin`과 결과 `{login}`·`{filled}`, core의 origin 재기와 `hold`, shell main의 `submitRequest` 거의 전부, form.
- **덧댄 자리**: login 요청은 대화의 pending에서 자기 칸이 없다. `pending.questions`가 있는데 `questions`가 `null`이면 login card로 그린다(`agent-view.tsx`). 요청 종류가 늘면 이 표시로는 가를 수 없다.

## 무엇을 만드나

**agent는 값이 아니라 자리를 가리킨다. 자리가 무엇이고 값이 어디로 가는지는 core가 선언에서 읽어 card에 보인다.**

- **자리(slot)는 넷이다.**
  - provider: 아직 연결하지 않은 definition의 key, 또는 연결된 provider의 key 바꾸기
  - 앱 secret: 그 앱이 `secret.use`로 선언한 이름
  - MCP server: 이미 설정에 있는 server의 값
  - site login: 지금 `lophn login request`(탭의 입력 칸)
- **요청 하나의 모양은 같다.** agent가 `lophn secret request <자리>`를 부른다 → 대화에 card가 뜬다 → 사람이 [Enter]를 누르면 보호 창이 열린다 → 저장하고, 자리에 뒤따르는 일(provider면 연결)까지 한 뒤 → agent는 `stored`, `cancelled`, `unattended`, 또는 값이 빠진 실패 code만 받는다.
- **card는 값이 가는 곳을 보인다.** provider면 endpoint host, 앱이면 앱 이름과 그 secret을 보내겠다고 선언한 목적지, MCP면 server URL이다. agent가 넘긴 글이 아니라 core가 definition, 앱 선언, server 설정에서 읽은 값이다(login 요청에서 origin을 shell main이 재는 것과 같은 이유다). 이미 값이 있는 자리면 "바꾼다"고 보인다.
- **sign-in도 같은 card다.** 구독 provider, 앱 OAuth, MCP OAuth는 넣을 값이 없고 사람이 browser에서 로그인한다. card의 button이 [Sign in]이고 지금 화면의 sign-in 흐름을 그대로 돈다.
- **값이 없어 실패한 쪽은 어느 자리가 비었는지 듣는다.** 앱 호출과 MCP tool 호출이 값·sign-in이 없어 실패하면 결과에 자리가 실린다. agent는 그것을 그대로 `secret request`에 넘긴다.
- **agent 지침을 바꾼다.** "묻지 마라"를 "값을 대화로 받지 마라. 필요하면 `lophn secret request`로 요청해라"로 고친다.

끝나면:

- home에서 "OpenRouter 연결해 줘" → card에 OpenRouter와 endpoint host가 뜨고, key를 넣으면 연결되고 agent가 model 목록을 읽어 이어 간다.
- 앱을 짓는 agent가 `secret.use`를 선언한 뒤 바로 요청한다. 사람은 대화를 떠나지 않고 넣고, agent는 `stored`를 받아 앱을 돌려 본다.
- 터미널의 Claude Code나 Codex도 lophn 안에서 같은 명령으로 요청한다.

## 정한 것

1. **값은 보호 입력 창으로만 들어가고, 창은 사람이 card를 눌러야 열린다(agent).** `browser-vault`의 결정 그대로다. `secrets/put`과 `providers/connect`는 계속 사람 자격(shell main)만 부른다. agent에게 여는 것은 "요청" route 하나다. `config-surface` 정한 것 3과 부딪히지 않는다: agent가 secret을 바꾸는 것이 아니라 사람이 넣는다.
2. **agent는 secret 이름을 정하지 못한다(agent).** 자리를 넘기면 core가 이름을 만든다(`provider.<id>`, 앱이 선언한 이름, `mcp.<scope>.<server>`). 이름을 받으면 agent가 다른 자리의 값을 덮어쓰게 하거나, 값을 자기가 고른 목적지로 나가는 이름에 넣게 할 수 있다(`ConnectProvider`가 자기 몫 이름만 받는 것과 같은 이유).
3. **없는 자리는 요청하지 못한다(agent).** 앱이 선언하지 않은 이름, 설정에 없는 MCP server는 `not_found`다. 자리를 만드는 일(선언 고치기, server 더하기)은 지금 길 그대로다.
4. **요청 모델은 하나로 합친다(agent).** `login_request`를 옆에 하나 더 복사하지 않는다. 사람에게 입력을 청하는 요청 하나에 종류(site login, 저장하는 secret, sign-in)를 두고, 대화의 pending도 `questions: null` 표시 대신 자기 칸을 갖는다. login 요청은 그 한 종류로 옮긴다. `ask`와 같은 대기열, 같은 "session당 하나", 같은 `unattended` 규칙을 쓴다.
5. **승인(Gate)과 섞지 않는다(agent).** 요청은 권한을 주지 않는다. 앱이 그 secret을 쓰려면 지금처럼 `secret.use`와 `net.fetch` 허락이 따로 있어야 한다(`architecture/approval.md` "표시는 할당을 넓히지 않는다").
6. **custom provider도 받는다(agent).** agent가 base URL과 protocol을 넘기고, card가 그 host를 크게 보인다. 사람이 host를 보고 key를 넣는 것이 확인이다. loopback이 아닌 host에 key 없는 연결을 만드는 길은 지금처럼 없다.
7. **요청이 실패해도 반쯤 된 상태를 남기지 않는다(agent).** provider 연결이 실패하면 지금 화면처럼 secret을 지우고, agent는 code만 받는다.
8. **Settings 화면은 그대로 둔다(agent).** 화면의 입력 길은 남고, 요청은 같은 창과 같은 저장 길을 쓴다. MCP의 "이미 있는 server의 값 바꾸기"는 요청이 쓰는 길을 화면에도 button 하나로 건다.
9. **사람이 없는 turn은 바로 `unattended`다(agent).** 예약 실행 중에 뜬 요청을 쌓아 두었다가 나중에 보이는 일은 `headless-schedule`의 몫이다.

## 사람이 정할 것 (추천안으로 진행)

1. **어느 workspace의 agent가 무엇을 요청하나.**
   - 추천: home의 lophn은 모든 자리. 앱 agent는 자기 앱이 선언한 secret과 자기 agent 정의의 MCP server만. project agent는 자기 agent 정의의 MCP server만. provider 연결은 home과 사람의 터미널에서만.
   - 얻는 것: 가장 자주 막히는 곳(앱을 짓다가 key가 필요할 때)이 풀린다. 앱 agent가 다른 앱이나 provider를 건드리는 card를 띄우지 못한다.
   - 잃는 것: project에서 일하다 "이 provider도 붙여 줘"는 home으로 가야 한다.
   - 다른 길: `config-surface`처럼 home에서만 연다. 단순하지만 앱을 짓는 흐름이 그대로 끊긴다.
2. **agent 없이도 실패한 자리에서 바로 넣게 할 것인가.**
   - provider key가 없으면 agent의 turn 자체가 돌지 않아 agent는 요청할 수 없다. 지금은 "Settings → Providers"라는 글뿐이다.
   - 추천: 한다. 그 오류 줄에 같은 창을 여는 button을 건다. 요청과 같은 "자리 → 창" 길을 쓰므로 일이 작다. 순서 2에 둔다.
   - 잃는 것: 대화 화면에 button 하나가 는다.

## 순서

1. **요청 모델과 저장하는 secret.**
   - login 요청을 종류가 있는 요청 하나로 고치고 pending에 칸을 준다.
   - 자리 셋(provider key, 앱 secret, MCP server)의 해석: 자리 → secret 이름, card에 보일 목적지, 뒤따르는 일.
   - `lophn secret request` 명령, card, 창의 purpose 연결. `lophn login request`는 같은 모델 위에 선다.
   - 공통 prompt, 앱 prompt, `lophn-agent` skill 글. 앱 agent 지침이 바뀌므로 `sdk-note` 메모.
2. **sign-in과 빈 자리 알리기.**
   - 구독 provider, 앱 OAuth, MCP OAuth의 [Sign in] card.
   - 앱 호출과 MCP tool 호출의 실패에 빈 자리를 싣는다.
   - provider 오류 줄의 button(사람이 정할 것 2).
   - Settings의 MCP 값 바꾸기 button.

## 하지 않는 것

- agent가 secret 값을 읽거나, 만들거나, 대화로 받는 것.
- agent가 보호 창을 직접 여는 것, card 없이 저장하는 것.
- agent가 provider를 끊거나 secret을 지우는 것. 지우는 일은 화면에 둔다.
- 요청으로 권한(grant)을 같이 주는 것.
- 사람이 없는 turn의 요청을 쌓아 두는 것, 알림으로 보내는 것.
- `secrets.json` 암호화, OS keychain, 외부 password manager.
- 앱 secret 이름을 앱마다 나누는 것(지금 전역 이름). card가 "이 이름을 선언한 다른 앱도 같이 쓴다"를 보이는 데서 그친다.

## 같이 고칠 문서 (일을 시작할 때)

- `project-docs/architecture/agent-definition.md`: secret 저장소 절에 "agent의 요청" 길.
- `project-docs/architecture/browser-tab.md`: login 요청 절을 요청 모델 하나의 한 종류로.
- `project-docs/architecture/agent-chat.md`: pending의 요청 칸.
- `project-docs/architecture/app-call.md`: 빈 자리 알리기.
- `project-docs/products/roadmap/config-surface.md`: 정한 것 3과 "하지 않는 것"에서 이 문서를 가리킨다.
- `project-docs/flows/`: 새 명령과 route, 바뀐 login 요청.

## 일의 모양

순서 1은 서로 기댄다(요청 모델 → 자리 해석 → card와 창 → 지침). 계획 폴더를 열지 않고 branch 하나에서 한 줄로 한다. 순서 2의 네 일은 순서 1 뒤에 서로 떨어져 있어 나눠 돌릴 수 있다.
