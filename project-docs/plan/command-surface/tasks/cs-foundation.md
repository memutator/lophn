# cs-foundation

lophn이 내놓는 명령을 새 package `packages/cli`의 표 하나에 세운다. lophn agent는 native tool `lophn` 하나로 그 명령을 부른다. 지금의 CLI를 옮기고, job tool 넷을 첫 명령으로 옮긴다.

- 단위: cli (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/cli/**`
  - `packages/coding-agent/**`
  - `packages/protocol/coding-agent/**`
  - `packages/core/lophn-agent/tools/{registry.ts,registry_test.ts,work.ts,work_test.ts,dispatch.ts,define.ts,spi.ts,tool-context.ts,display.ts,display_test.ts,result.ts,fit-result.ts,wire.ts,wire_test.ts,model.ts,commands.ts,mod.ts,ports.ts,reads.ts,schema.ts,toolkit.ts,erase.ts}`
  - `packages/core/lophn-agent/tools/bundles/**`
  - `packages/core/lophn-agent/tools/lophn/**`
  - `packages/core/lophn-agent/run-loop/**`
  - `packages/core/agent-places/{tool-lists.ts,tool-lists_test.ts,credentials.ts}`
  - `packages/core/main/{agent-tools.ts,agent-tools_test.ts,tool-names_test.ts}`
  - `packages/core/main/agent-runtime/**`
  - `packages/core/jobs/agent-tools.ts`
  - `packages/protocol/lophn-agent/{tool-catalog.ts,tool-values.ts}`
  - `packages/base/install/linux-install.ts`
  - `tools/dev.ts`
  - `tools/doctor/**`
  - `tools/check-deps.ts`
  - `package.json`
  - `package-lock.json`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 1~9
  - architecture: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/run.md`("CLI와 자격"), `project-docs/architecture/agent-definition.md`(tool 목록, credential, 늦게 싣기), `project-docs/architecture/layers.md`
  - 지금 CLI: `packages/coding-agent/cli/`, `packages/protocol/coding-agent/cli-commands.ts`, `packages/coding-agent/connection/`
  - 본보기 dispatch: `packages/core/lophn-agent/tools/dispatch.ts`(`dispatchTarget`), `packages/core/lophn-agent/run-loop/tool-batch.ts`
- 계약:
  - 쓰는 것: core route(protocol)는 그대로 쓴다.
  - 내놓는 것: `packages/cli/commands/`의 명령 모양과 등록 목록. wave 2 task가 남은 내장 tool을 이 모양으로 옮긴다. 모양은 아래 "할 일" 2를 지키고 이름은 worker가 정해 보고에 적는다.

## 할 일

1. **package를 세운다.** `packages/cli`(`@lophn/cli`)를 만들고 `packages/coding-agent/cli/**`와 `packages/coding-agent/connection/**`을 옮긴다. binary 입구는 `packages/cli/main.ts`다. `local` 명령(`hook`, `harness *`)의 code는 `packages/coding-agent`에 남기고 export한다. `main.ts`만 그것을 끼운다. binary 경로를 쓰는 곳(`packages/base/install/linux-install.ts`, `tools/dev.ts`의 dev launcher, `tools/doctor/`, packaging script)을 고친다. core는 `packages/cli/commands/`와 parser·help만 import하고 `main.ts`·`connection/`은 import하지 않는다. 이 규칙을 `tools/check-deps.ts`에 둔다.
2. **명령 표를 하나로 만든다.**
   - `packages/cli/commands/`에 둔다. 명령마다 같이 두는 것: 이름(점 이름, 예 `job.create`. argv 낱말은 `.`로 나누고 `_`는 `-`), 한 줄 summary, description, zod 입력, positional, effect(`read|write|external`), 부르는 route 목록, 부를 수 있는 lophn agent의 place 종류(빈 목록이면 binary만), 실행 함수.
   - 실행 함수가 받는 것: core를 부르는 interface(read와 idempotency key를 받는 command. binary는 user token HTTP client를, `lophn` tool은 agent credential의 `CoreCall`을 끼운다), idempotency key, place(binary에서는 없음), clock, abort signal.
   - 실행 함수가 돌려주는 것: summary, JSON content, 줄일 수 있는 배열 key 목록. 24 KiB에 맞추는 것(`fitted`)은 `lophn` tool 쪽 adapter가 한다. binary는 전부 찍는다.
   - `packages/protocol/coding-agent/cli-commands.ts`의 표, CLI의 둘째 표, 둘을 맞추는 boot check, 이름 끝 낱말로 짐작하는 `mutates`를 지운다.
   - 지금 `user` 명령(`agent run`, `tool call`, `run wait|show|cancel`, `workflow start|report|stop|show`)을 이 표로 옮긴다. place 종류는 비운다(binary만).
3. **parser, help, output을 표의 schema에서 만든다.**
   - flag: `--field-name value`(칸 `field_name`), boolean은 `--flag`, 배열은 같은 flag를 되풀이한다. 숫자와 enum은 zod가 읽는다. `--input <json>`은 입력 object에 합친다. positional slot.
   - 모르는 flag는 `invalid_input`과 usage 한 줄이다.
   - help: `lophn help`, `lophn <group> --help`(묶음의 명령 목록), `lophn <command> --help`(usage, description, 칸).
   - help와 오류 글은 영어다. exit code는 지금 값 그대로다.
4. **native tool `lophn`을 만든다.**
   - 입력은 `{ args: string[] }`다. pipe나 `&&`는 없다.
   - loop가 기록·gate·retry·effect 판단 전에 `lophn` 호출을 그 명령의 호출로 푼다. `dispatchTarget`을 넓히면 된다.
     - 기록되는 tool 이름은 명령 이름(`job.create`)이다.
     - effect, operations(route), display는 명령에서 온다. display는 명령줄로 만든다.
     - idempotency key는 그 tool call의 id다.
     - place는 session의 것이다.
     - provider에 다시 보내는 이력에는 원래 `lophn` 호출이 그대로 간다.
   - tool 설명은 고정된 사용법 글과, 그 place 종류가 부를 수 있는 명령(이름과 summary, 이름순)이다. 같은 place 종류면 같은 bytes여야 한다(cache).
5. **place 종류마다 부를 수 있는 명령만 부른다.**
   - `lophn`은 그 session의 place 종류에 허락되지 않은 명령을 실행하지 않는다. 지금 목록 밖 tool과 같은 실패다.
   - agent credential의 operation 상한(`placeOperations`, `packages/core/agent-places/credentials.ts`)에 그 place 종류가 부를 수 있는 명령의 route를 더한다.
6. **job tool 넷을 명령으로 옮긴다.**
   - `job.create|update|delete|list`(`packages/core/jobs/agent-tools.ts`)를 `packages/cli/commands/`의 job 명령으로 옮긴다.
   - agent-tools file을 지우고 `TOOL_ORDER`와 place 목록에서 뺀다.
   - 지금 tool이 부른 쪽에 따라 하던 판단(`ctx`의 agent·domain·place)이 있으면 core route가 credential을 보고 하게 옮긴다. 같은 명령을 binary가 user token으로도 부르기 때문이다.
7. place prompt, 내장 skill, eval에 남은 `job.create` 같은 이름은 고치지 않는다. wave 3 task가 고친다. 보고의 "넘길 줄"에 적는다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "`lophn` tool은 그 session의 place 종류에 허락되지 않은 명령을 실행하지 않고, agent credential의 operation 상한에도 그 명령의 route가 없다"
- 위험 test: "write 명령을 같은 tool call로 다시 부르면 같은 idempotency key로 간다"(이미 같은 것을 보는 test가 있으면 그것을 옮긴다)
- 남지 않음: `grep -rn "CODING_CLI_COMMANDS\|coding-agent/cli\|coding-agent/connection" packages tools`가 0줄이다.
- `lophn help`와 `lophn job create --help`가 dev launcher로 영어 help를 찍는다.

## 보고

- 바꾼 file
- 통과한 check
- 명령 모양과 등록 목록의 실제 이름(wave 2 task가 쓴다)
- 등록할 것
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
