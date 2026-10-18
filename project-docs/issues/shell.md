# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 보낸 chip이 대화에 남지 않고 다시 보내기가 chip을 빼고 보낸다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/protocol]
```

지금: composer의 context·위반 chip은 `SendMessage.attached`로만 간다(`packages/shell/renderer/conversation/attached-chips.ts`의 `attachedOf`, `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`의 `sendText`). core는 그것을 Router 입력 본문 앞의 `<lophn-attached …>` 줄로 만들 뿐 message 본문(`content.parts`)에는 chip이 없다. 그래서 대화 화면에는 보낸 글만 보이고, 같은 file의 `retryTurn`은 본문에서 chip을 다시 만들 수 없어 `attached: []`로 다시 보낸다. 글 없이 chip만 보내면 본문은 chip 라벨뿐이다.

영향: 사람은 어떤 위반·context를 붙여 보냈는지 대화에서 다시 볼 수 없다. 실패한 turn을 다시 시도하면 agent는 처음에 받은 위반(파일·규칙)을 받지 못하고 라벨 글만 본다.

고치려면(작음): 본문의 `attached` part는 이미 있다(`packages/protocol/lophn-agent/message-content.ts`의 `attachedFields`). 대화 화면의 `readBody`가 그 part를 그리고 `retryTurn`도 본문의 part를 복사한다. 모자란 것은 둘이다. (1) `attachedFields`에 optional `context`(ctx id)를 더하고 `sendText`가 chip마다 `attached` part를 본문에 쓴다. (2) `retryTurn`이 본문의 `attached` part로 `SendMessage.attached`를 다시 만든다.

정한 것: 위대로 고친다. 앞서 "보낸 chip은 본문에 남기지 않는다"고 정한 것(agent)을 뒤집는다. 다시 시도한 turn에서 agent가 위반을 잃는 것이 고치는 비용보다 크다. (agent)

## 일반 설정 통로의 MCP 함수를 화면이 부르지 않는다

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `packages/shell/renderer/desktop/settings/source.ts`의 `SettingsSource`에 `settings()`(skill 폴더와 MCP server 목록), `addSkillFolder`, `addServer`, `enterServerCredential`, `beginSignIn`, `cancelSignIn`, `finishSignIn`이 있고 `settings/core-source.ts`의 `coreSettingsSource`와 `settings/testdata/fake-settings.ts`가 구현한다. 화면에서 부르는 곳이 없다(`packages/shell`과 `tools`에서 `.addServer(`, `.enterServerCredential(`, `.beginSignIn(`, `.settings()` grep 0건). General 탭은 `declared`·`update`만 쓰고, Tools and skills 탭은 `AgentsSettingsSource`(`settings/agents/core-source.ts`의 `readExtensions`, `createServer`)를 쓴다.

영향: MCP server를 더하는 길이 둘이라 설정 꼴이나 secret 이름 규칙이 바뀔 때 두 곳을 고쳐야 한다(MCP credential을 `secrets.json`으로 옮길 때 쓰이지 않는 쪽도 새 꼴로 고쳤다). 개발 비용이다.

고치려면:
- 지운다(작음): `SettingsSource`의 위 함수와 그것만 쓰는 type(`SettingsView`, `ServerRow`, `NewServer`, `ServerSignIn` 등), `coreSettingsSource`와 fake의 구현을 지운다. 잃는 기능은 없다. 추천.
- 둔다: 전역 MCP 화면을 일반 설정 통로로 되돌릴 계획이 있을 때.

정한 것: 지운다. 잃는 기능이 없는 죽은 코드다(issue skill "정하기"). (agent)

## 설정 화면의 command가 compare를 빼서 provider 연결과 기본 model 바꾸기가 모두 거절된다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: `packages/shell/renderer/desktop/settings/core-call.ts`의 `command()`는 `compare`를 받지 않으면 봉투에서 그 칸을 뺀다. command 봉투(`packages/protocol/base/envelope.ts`의 `commandRequestSchema`)는 compare가 없는 route에도 `compare: {}`를 요구하는 strict object라, main의 contract client(`packages/shell/main/desktop/core/client.ts`의 `openSession` → `packages/protocol/client/client.ts`)가 core에 보내기 전에 `invalid_input`으로 돌려준다. 이 helper로 compare 없이 보내는 곳은 `settings/providers/core-source.ts`의 `connectWithKey`(API key 연결), key 없는 custom provider 연결, `signIn`의 `login-begin`·`login-complete`·`login-cancel`, `settings/agents/core-source.ts`의 `changeDefaultModel`이다. 재현: 실제 core에 화면의 `coreProviderSettingsSource`를 main의 `openSession`·`nodeFetch`로 붙여 `connect("openai", "oauth")`를 부르면 `providers/definitions` read는 성공하고 `login-begin`이 `invalid_input`이다.

renderer에서 command 봉투를 손으로 짜는 곳이 10개 file에 11곳이다. type이 compare를 강제하는 곳은 대화의 `conversation/agent-tab-core-source-env.ts`(`CommandBody`) 하나이고, 나머지는 `compare: {}`를 손으로 적는다.

영향: 사람이 설정 화면에서 provider를 하나도 붙이지 못한다. API key, custom, ChatGPT·SuperGrok 로그인 모두 "Couldn't connect"로 끝나고 browser도 열리지 않는다. Agents 탭에서 기본 model도 바꾸지 못한다. dev는 `tools/dev.ts`가 fake provider를 core에 직접 연결해 두어 드러나지 않았다. 화면 test는 가짜 CoreSource를 쓰고 e2e는 core에 봉투를 직접 만들어 불러서, 화면이 만든 봉투를 contract schema로 보는 곳이 없다.

고치려면:
- 설정 helper만 고친다(작음): 늘 `compare: body.compare ?? {}`를 보낸다. 손으로 짠 봉투 11벌은 그대로다.
- 봉투를 하나로 모은다(작음~중간): 대화의 `CommandBody`처럼 protocol route를 받아 input·compare type을 route에서 꺼내는 helper 하나를 renderer에 두고 11곳이 그것만 쓴다. compare가 없는 route는 type이 `{}`를 강제한다. guard는 그 helper가 만든 봉투가 `commandRequestSchema`를 통과하는지 보는 test 하나(process 없이).

정한 것: 봉투를 하나로 모은다. 화면마다 손으로 짠 봉투가 11벌이라 한 곳의 실수가 설정의 연결 기능 전체를 조용히 막았다.
