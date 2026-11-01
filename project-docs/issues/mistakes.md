# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

## 계획이 본보기와 다른 모양을 정했는데 lead review가 README 대조만 함

```yaml
kind: mistake
modules: [tools]
```

지금: deferred-tools 계획은 "Claude Code의 ToolSearch와 같은 꼴"을 목표로 했지만, "정한 것"에서 숨김을 role마다 손으로 적은 이름 목록 넷(role prompt에 이름이 나오는지로 고름)으로 정했다. Claude Code는 tool 정의의 `shouldDefer` 하나로 정하고, role 구분은 이미 권한 목록(`builtinToolNames`)이 하고 있었다. worker는 README대로 만들었고 lead는 diff가 README와 같은지만 보고 merge했다. eval까지 돈 뒤 사람이 물어서 드러났고 wave 2로 다시 만들었다.

영향: worker 한 판, eval 한 판($1.52), 사람의 시간. 같은 개념(어느 role이 무엇을 보나)을 두 목록이 갖게 될 뻔했다.

원인: 계획이 본보기를 이름으로만 가리키고(조사 문서 README), 본보기의 판단 장치(`source/deferral-policy.js`)를 "정한 것"과 대조하지 않았다. orchestrate review 표에는 "계획의 목표·본보기와 맞나" 칸이 없다.

막기: 추천은 둘이다. planner-persona skill에 "본보기를 따른다고 쓴 계획은 정한 것마다 본보기의 해당 장치와 다른 점을 한 줄로 적는다"를 더한다. orchestrate skill review 표에 "계획 목표 문장(사람의 말)과 본보기에 비춰 모양이 맞나"를 더한다.

## app command dispatch가 wire 이름이 아닌 이름을 돌려 모든 앱 command 호출이 실패

```yaml
kind: mistake
modules: [packages/core/lophn-agent]
```

지금: command-surface의 app-commands task가 `prepare.ts`의 `dispatch`에서 풀린 앱 command를 `<domain>.<command>` 이름으로 돌려줬다. 실행기는 wire 이름(`<domain>_<command>`)으로 찾아 `lophn <domain> <command>`가 모두 "tool is not available"이었다. worker는 실제 turn으로 돌려 보지 않았다고 보고했고 unit test는 풀기까지만 봤다. 같은 계획의 e2e-rewrite가 e2e로 찾았고 merge 전에 고쳤다(`resolveAppCall`이 wire 이름을 낸다).

영향: 계획의 핵심 기능이 plan branch에서 한동안 동작하지 않았다. main에는 가지 않았다.

원인: dispatch를 바꾸는 task의 끝남에 "풀린 호출이 실행기의 찾기까지 이어진다"는 기준이 없었다. 내장 명령의 길(`resolveLophnCall`)은 wire 이름을 냈는데 새 길이 그것을 따르지 않았다.

막기: `packages/core/lophn-agent/tools/app-public_test.ts`에 풀린 앱 command를 `toolForWireName`으로 찾는 test를 더했다. 실행 경로를 바꾸는 brief의 위험 test는 "입력부터 실행기까지 한 번 이어 본다"로 쓴다.
