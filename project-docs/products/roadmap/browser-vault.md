# browser vault와 전역 memory

상태: 계획 `browser-vault`(`project-docs/plan/browser-vault/`)로 열었다. 정한 것은 계획 README에 있다.
배경 문서: `harness-lab/_report/browser-vault/README.md`(15개 harness의 credential 보관·주입 비교), `harness-lab/_report/memory-architecture/README.md`, `project-docs/architecture/browser-tab.md`, `project-docs/architecture/agent-definition.md`(memory, secret 저장소).

## 왜

- agent가 browser 탭에서 로그인해야 할 때 지금 길은 둘뿐이다. 사람이 먼저 로그인해 둔 cookie(`persist:lophn-browser`, 모든 탭과 agent가 같이 쓴다)를 이어 쓰거나, agent가 `lophn browser act ... type`에 비밀번호를 평문으로 넣는 것이다. 평문은 tool 인자로 transcript와 ledger에 남는다. cookie가 만료되거나 처음 가는 site면 사람이 직접 로그인해야 한다.
- 비교한 harness 가운데 전용 vault는 Hermes와 Skyvern뿐이다. 둘 다 model에게 값을 주지 않고 handle만 준다. Hermes는 origin을 값 해석 전과 입력 직전에 두 번 확인한다. lophn에는 그 부품(이름으로 가리키는 `secrets.json`, 저장된 값을 모두 등록하는 known-value redaction, 보호 입력 창)이 이미 있고, page 입력 칸으로 넣는 길과 agent가 입력을 요청하는 길만 없다.
- "이 일은 회사 계정으로" 같은 의도는 memory에 둔다. 그런데 browser cookie와 secret은 전역인데 memory는 workspace마다 나뉘어, 한 project에서 알게 된 계정 사실을 다른 project의 agent가 모른다.

## 무엇을 만드나

- **전역 memory**: Home memory(`<data>/home/memory.md`)를 모든 workspace의 agent가 받는다. 쓰는 것은 그대로 Home lophn과 사람이다.
- **login 저장**: 사람이 Settings › Browser에서 login(label, origin, username, password, 선택 TOTP seed)을 넣는다. 값은 `secrets.json`, 나머지는 metadata로 둔다.
- **handle로 채우기**: agent가 `lophn login list`로 그 origin의 login을 보고, `lophn browser act`의 새 행동으로 handle을 주면 shell main이 origin을 확인하고 값을 page에 친다. model은 값을 보지 않는다.
- **agent의 입력 요청**: agent가 탭의 입력 칸을 가리켜 사람에게 login 입력(저장)이나 한 번만 넣기(2FA 코드 등)를 요청한다. 사람이 대화의 card에서 눌러 보호 입력 창을 연다. 창은 탭의 실제 origin을 보인다.

## 하지 않는 것

- 결제 카드, 주소, 신원 정보 저장.
- 외부 password manager(1Password, Bitwarden) backend, Chromium 비밀번호 관리자 연동, 사람 Chrome에서 가져오기.
- `secrets.json` 암호화와 OS keychain.
- browser partition 나누기(workspace별, agent 탭 전용).
- 비밀을 넣은 탭에서 `evaluate`·screenshot 막기.
- 이메일·SMS 코드 자동 수신.
