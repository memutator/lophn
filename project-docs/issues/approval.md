# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.

## grant read가 `sessions` 표를 SQL로 직접 읽는다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/lophn-agent]
```

지금: `agentGrantsGetRead`(`packages/core/approvals/grants/reads.ts`)는 agent actor의 자기 ref를 만들려고 lophn-agent의 `sessions` 표를 `select role, project, app, operator from sessions where id = ?`로 직접 읽는다. approvals가 lophn-agent를 import하지 않으려고 이렇게 했다. module이 남의 표를 SQL로 읽지 않는다는 규칙에 어긋나고 `check-deps`는 이를 잡지 않는다.

영향: `sessions` 표의 칸 이름이나 모양이 바뀌면 grant read가 소리 없이 `forbidden`이 되고, 그러면 place prompt의 "Agents you can call"에서 session 없는 상대가 모두 빠진다(실패한 grant read는 후보를 싣지 않는다).

고치려면: 호출하는 쪽(`packages/core/agent-roles/place/place-data.ts`)이 이미 가진 자기 ref를 믿지 않고, router의 `callGate`처럼 wiring에서 actor의 ref를 풀어 read context로 넘긴다(중간). 또는 lophn-agent가 actor→ref read를 내고 approvals가 그것을 부른다(작음). 추천은 뒤의 것이다.
