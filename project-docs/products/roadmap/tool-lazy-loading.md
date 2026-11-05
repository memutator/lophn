# Tool lazy loading 공통화

상태: 구현했다(2026-10-29, `change-log/0.9.0.md`의 "tool 정의를 모든 provider에서 늦게 싣는다"). 공통 경로는 `tool.load` + `tool.call`, native는 Anthropic `defer_loading`이다. 정책은 `agent-workspaces/tool-lists.ts`의 `exposedToolNames`, 동작은 `architecture/agent-definition.md`다. 남은 native 연결(OpenAI Responses `tool_search`)은 `plan/context-cache`의 `defer-responses`다. 아래는 착수 전 계획 기록이다.

선행 계약 정리(조회 세 쌍을 `app.read`·`domain.read`·`package.read`로 합치기)는 0.9.0에서 끝났다(`change-log/0.9.0.md`). loader는 그 결과 registry를 입력으로 받는다.

목표는 tool 정의를 필요할 때 model context에 넣는 동작을 provider와 무관하게 제공하는 것이다. 현재 tool 이름·개수·분류나 토큰 수를 구현 계약으로 고정하지 않는다.

진행 순서:

1. **최적화가 끝난 registry에서 시작한다.** 세션이 받을 수 있는 tool catalog와 기존 정의를 유일한 source로 쓴다. 목록·description·schema를 loader에 복사하거나 이름 prefix로 별도 분류하지 않는다. 상시 노출 여부도 그때 확정된 정책·metadata를 따른다.
2. **공통 loading·dispatch 경로를 만든다.** 일반 tool calling만으로 정의 조회와 호출이 가능하게 한다. dispatcher의 공개 이름과 입력 형태는 착수 때 정한다. 실제 호출은 세션의 허용 catalog에서 해석하고 기존 input 검증·Gate·handler를 거친다. 승인·기록·retry·rewind도 실제 대상 tool의 이름과 effect를 기준으로 처리하며, wrapper 때문에 쓰기가 중복 실행되지 않게 한다.
3. **세션과 이력 규칙을 맞춘다.** 목록 고정·정의 변경 알림·호출 시 현재 권한 재검사라는 기존 규칙을 유지한다. 로드 상태를 이력·resume·compaction에서 일관되게 다루고, 정의 변경 판단에는 기존 정의 hash를 쓴다. 로드 자체가 권한을 추가하지 않는다.
4. **native 연결은 protocol adapter에 둔다.** 공통 경로를 기준 동작으로 먼저 완성한다. native loading은 지원하는 API protocol별로 연결하고 provider·model의 capability로 선택한다. endpoint 경로만으로 지원을 가정하지 않는다. native 경로도 같은 catalog·loading 정책·실행 경로를 쓰며, token·왕복·cache 효과를 확인해 적용 범위를 정한다.
5. **그 시점의 정의로 검증한다.** 최종 registry의 초기 정의 토큰과 필요한 로드 호출 수를 확인한다. model 비교 eval은 하지 않는다(사람, 2026-10-29). 테스트는 허용 범위 밖 tool 호출 차단, Gate 우회 방지, 쓰기 중복 실행 방지에 집중하고 기존 fake·녹화 재생을 쓴다. 변경된 계약의 소비자와 [agent-definition architecture](../../architecture/agent-definition.md)를 함께 갱신하고 `npm run check`를 실행한다.

완료 기준: tool을 추가·삭제·통합하거나 이름·description·schema를 바꿔도 loader의 별도 목록을 고칠 필요가 없고, 공통/native 경로 모두 기존 권한과 실행 의미를 지킨다. 특정 tool의 유지, 상시 노출 개수, 절감 목표치는 이 계획에서 정하지 않는다.

## 기본 노출 정책 초안

2026-10-29 검토용 제안이다. 현재 이름으로 분류했으며 실제 반영은 계약 정리 뒤에 한다. 이름·개수는 loader의 고정 계약이 아니다. workspace별 기본 노출 정책을 한 곳에서 정해 최종 catalog의 metadata로 전달하고, loader에 같은 목록을 복사하지 않는다. 현재의 공통 defer 표시와 새 정책을 이중으로 유지하지 않는다.

기준은 첫 요청부터 자연스럽게 써야 하는 기본 작업·질문·협업·완료 보고를 먼저 보이는 것이다. 관리·설정·특수 조회는 정의를 필요할 때 읽는다. task를 추측하는 자동 분류기나 숨긴 tool을 자동 실행하는 장치는 만들지 않는다.

| 기본 노출 | 현재 tool |
|---|---|
| 공통 파일 탐색 | `file.read`, `file.glob`, `file.grep`, `file.outline` |
| 이미지와 웹 | `image.read`, `web.search`, `web.fetch` |
| 질문·협업·보고 | `ask`, `call`, `reply`, `cancel`, `workflow.report` |
| skill과 tool 발견 | `skill.read`, 현재 `tool.load`에 해당하는 진입점 |
| home의 앱 탐색 | `app.list/get`(통합 후 `app.read`), `app.tools` |
| project·app의 작업 | `file.write`, `file.edit`, `shell.run` |

`ask`는 사람이 결정할 때, `reply`·`workflow.report`는 받은 일을 끝냈을 때 바로 선택할 수 있게 둔다. `image.read`는 사용자가 붙인 이미지와 annotation을 읽는 기본 동작이다.

숨기는 것은 위 기본 집합에 없는 **허용된 tool의 정의**다.

| 숨길 묶음 | 현재 tool |
|---|---|
| 특수 파일·세션 조회 | `pdf.read`, `session.list` |
| 앱 관리·진단 | `app.create`, `app.link_source`, `app.status`, `app.logs`, `app.invocations` |
| 앱·SDK 탐색의 나머지 | home 외의 `app.list/get/tools`, `package.list/get/publish` |
| 검증·배포·preview | `declaration.check`, `release.*`, `preview.*` |
| 설정·지침·화면 출력 | `settings.get`, `instructions.read`, `visual.show` |
| agent와 예약 작업 관리 | `agent.create/update`, `job.*` |
| workflow 관리 | `workflow.list/get/edit/check` |
| 할당된 확장 | 앱 tool과 외부 MCP tool 전부 |

작업을 시작할 때 필요한 묶음을 한 번에 로드할 수 있게 한다. 예를 들어 앱 배포는 release·preview, 예약은 job 묶음을 읽는다. 로드한 정의는 기존 세션·이력 규칙에 따라 유지한다. catalog에는 이름과 짧은 기능 안내를 남겨 무엇을 로드할 수 있는지 알린다. 허용 범위 밖 tool은 이 안내에도 없고 로드도 할 수 없다.

현재 registry와 `tool.load` 표현으로 계산한 초안은 home 17개(약 2.5k token), project·app 각 18개(약 3.5k token)의 초기 정의다. schema와 숨긴 이름 목록만 센 값이며 추가 기능 안내와 새 dispatcher의 비용은 포함하지 않았다. 계약 통합과 공통 dispatcher의 공개 형태가 정해지면 재계산한다. 이 수치는 정의 크기 비교치이며 model 성공률 측정이 아니다.
