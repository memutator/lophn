# 말 표 (migration 작업용)

옛 요구의 말을 새 requirements로 옮길 때 이 표를 따른다. "쓰지 않음"인 말이 새 요구에 나오면 검사에서 걸린다.

| 옛 말 | 새 말 |
|---|---|
| documents (concern 이름) | projects. "문서"는 project 폴더의 파일을 가리키는 화면 말로만 쓴다. |
| platform (concern 이름) | core의 요소 이름(storage, events, server, supervision, approvals, config, secrets, diagnostics) |
| Focus | Context |
| preset, preset 판 | agent 설정 또는 agent 정의 |
| assignment | place에 놓인 agent(agent 정의) |
| Roles 화면 | project의 Agents 탭, 전역은 Lophn Workspace의 Settings |
| dock, 대화 dock, conversation 화면 | Agent 탭, session |
| run revert, revert_run, run 되돌리기 | session rewind |
| 판(문서의), version(문서의), `doc@ver`, file-tracking, tracking | 쓰지 않음(지운 것) |
| series registry, series 화면 | context 계약의 series kind |
| terms, Meanings, 용어 후보 | 용어집(glossary) |
| perspective, basis, reference, watch(context의) | 쓰지 않음(지운 것) |
| place 없는 문서 | 쓰지 않음(지운 것) |
| 자리 | `place`(agent가 놓이는 project 또는 앱). 일반 뜻의 위치는 "위치". |
| Things to confirm | 쓰지 않음(보류) |
| schedule, 주기 실행, scheduling | 쓰지 않음(보류) |
| backup, restore(backup의), export | 쓰지 않음(지운 것) |
| 계정(provider의 여러 계정) | provider 연결 하나 |
| command(앱이 내놓는 기능 하나), read command | app-api, 읽기 app-api. CLI 명령, `/` 명령, test command는 그대로 둔다. |
| app-capability-api | app-capability |
| app-packages (catalog 요소) | package-registry |
| fact, 반응할 사실 | domain event(ledger에 남고 Reactor가 반응하는 것). event는 domain event, agent event를 아우르는 말 |
| 바뀜 알림, change notification(core의 일반 장치) | 쓰지 않음(두지 않기로 했다). invalidation은 shell 안의 동작을 말할 때만 |
| 의도 참조(`documents#I6` 같은 꼴) | 쓰지 않음 |
| 옛 요구 ID(`platform/settings#R7`, `[R12]` 같은 꼴) | 쓰지 않음 |
| 옛 task·plan 번호(`T36`, `Q25`, `D33` 같은 꼴) | 쓰지 않음 |

말은 AGENTS.md "말" 절을 따른다. 개발자가 평소 쓰는 영어 단어나 굳은 음차를 쓰고, 번역어를 새로 만들지 않는다.
