# score-cli

사람 CLI는 control connect로 자격을 받고 ensure로 core를 띄운다. agent turn 자격은 user 자격으로 바꾸지 않으며 `core stop`은 시작 없는 별도 local 명령이다.

- 단위: cli (wave 4)
- 선행: score-shell
- 소유(이 task만 고친다):
  - `packages/cli/main.ts`
  - `packages/cli/main_test.ts`
  - `packages/cli/connection/`
  - `packages/cli/commands/core.ts` (새 file)
  - `packages/cli/help.ts`
- 읽을 것:
  - `project-docs/plan/standalone-core/README.md`, `project-docs/products/roadmap/standalone-core.md`
  - architecture: `project-docs/architecture/{run,coding-agent,approval,layers,platform}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli-interface`, `core-api`; module: `project-docs/module-catalog.yaml`의 `packages/cli`, `packages/protocol`
  - `packages/cli/main.ts:76-160`, `packages/cli/connection/client/{daemon,token,core}.ts`
  - `packages/cli/commands/{types,mod}.ts`, `packages/coding-agent/local/{mod,types,harness-run}.ts`
  - `packages/protocol/coding-agent/headless/env.ts`, score-control의 공용 ensure·control export
- 계약:
  - 쓰는 것: `ensureCore`, `identify`, 일반 `connect`, `stop`; user process 조건은 `cli`. shell capability는 요구하지도 받지도 않는다.
  - 내놓는 것: 사람의 core 명령은 ensure 뒤 실행한다. 주소 순서는 명시 option → `LOPHN_DAEMON_URL` → identify다. metadata·install settings·고정 port fallback은 없다. 명시 주소의 loopback 검사와 오류는 유지한다.
  - 내놓는 것: `LOPHN_AGENT_CREDENTIAL`가 있으면 그 자격으로만 API를 부른다. 만료·실패해도 user connect로 격상하지 않는다. 주소 찾기용 identify와 credential 발급은 다른 일이다.
  - 내놓는 것: `lophn core stop`은 local control 명령이며 ensure·spawn을 부르지 않는다. core가 없으면 공통 `unavailable`와 기존 exit 5로 끝난다. agent context에는 `forbidden`이고 agent tool 명령 목록에 넣지 않는다.

## 할 일

1. `main.ts`의 sync `connect`와 `connectionToken`을 새 비동기 연결 결과에 맞추고 모든 호출자를 같은 변경에서 고친다. metadata file을 읽어 token·port를 얻는 길을 제거한다. `createCoreClient`의 bearer는 connect 결과 또는 agent env token으로만 만든다. secret 출력기는 비동기로 받은 user token도 숨기게 한다.
2. 일반 user 명령은 공용 ensure를 사용한다. 개발은 이 checkout, 설치본은 이미 있는 platform layout의 Electron·core entry를 쓴다. PATH의 node나 shell main import에 의존하지 않는다. 공유 ensure에는 Node dial/spawnDetached adapter와 OS·제품 판·Clock을 인자로 준다. 새 node 전역 mutable registry는 만들지 않는다.
3. agent env token을 고르는 순서를 유지한다. agent 호출에는 user credential connect나 shell capability 발급을 하지 않고, 자격이 거절되어도 fallback하지 않는다. 명시 API 주소와 identify가 가리키는 core가 다를 때 한 core의 user token을 다른 loopback server에 보내지 않는다. 자격을 얻는 대상과 주소의 관계를 확인할 수 없으면 실패로 남긴다. 원격 인증은 만들지 않는다.
4. `core stop`은 binary local 명령으로 등록한다. `COMMANDS`를 core가 import하므로 node control 구현을 거기에 싣지 않는다. 표 등록이 필요하면 lead가 `commands/mod.ts`의 workspace 밖 선언과 local handler를 나누어 맞춘다. agent에게 제어 권한을 열기 위해 workspace 명령 상한을 넓히지 않는다.
5. version·help·hook·harness detect/install/status/uninstall은 core를 시작하지 않게 lazy connect를 유지한다. `harness sync-skills`는 지금 `ctx.core()`를 쓰므로 사람 ensure 경로로 자연스럽게 옮긴다. coding-agent local 구현 file은 소유하지 않고 계약 변경이 필요하면 lead에게 요청한다.
6. `daemon.ts`의 `runMetadataAddress`, 설치 설정·default fallback과 `token.ts`의 userTokenFile 인자를 없애고 export·type·주석·오류 문구도 맞춘다. 옛 `run-metadata.ts` protocol 정의와 core writer는 아직 다른 소비자가 있어 cleanup에 남긴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "agent credential이 실패해도 user connect로 바뀌지 않고, 다른 API 주소로 user token이 새지 않는다"를 주입한 control/fetch로 보는 unit table 한 개로 본다. 서버·subprocess는 띄우지 않는다. 기존 main test의 user-token-file 전제는 지우고 이 경계를 중복 없이 남긴다.
- 사람에게 물을 것: shell 없이 첫 CLI 명령으로 실제 detached core가 뜨고 core stop으로 끝나는 새 subprocess/E2E test. 허락 전에는 새로 만들지 않는다.
- 남지 않음: CLI의 `run/user-token`·`run/location.json` 읽기, 고정 7431 fallback, agent 자격 실패 뒤 user 발급, `core stop`이 꺼진 core를 띄우는 길.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. local 명령 등록 요청, 새 adapter와 제거한 export, 명시 URL의 자격 대상 확인 방법을 적는다.
