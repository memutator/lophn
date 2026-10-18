# workspace-detach: 탭을 OS 창으로 떼고 다시 붙인다

- 목표: 탭 하나를 detached 창(OS 창 하나)으로 떼고, [Dock]이나 창 닫기로 project 창에 돌려놓는다. terminal PTY, editor의 저장 안 된 글, agent draft, native view의 page 상태가 창을 건너도 산다. 다시 띄우면 detached 창이 bounds와 함께 돌아온다.
- 재료:
  - `project-docs/products/roadmap/workspace-float.md`: "지금 코드"의 창 여럿·kind별 다시 붙이기, "무엇을 만드나" 1(detached 몫)·4·5(detached 몫), "정한 것".
  - 계획 `workspace-float`이 쓴 `project-docs/architecture/workspace-layout.md`.
  - `project-docs/architecture/annotation.md`(app view identity), `project-docs/architecture/coding-agent.md`(terminal 탭).
- 범위 밖: 탭 줄이 있는 detached 창, detached 창끼리 옮기기, 다른 project 창으로 옮기기(roadmap "하지 않는 것").
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `wd-`로 시작한다.
- 단위: `tasks/*.md`의 "단위"가 정한다.
- 순서: layout(`detached` 칸, `attachDetached`)과 `TabKindDef.transfer`/`receive` 계약(wave 1) → detached 창과 main 중계·kind별 transfer·native view 옮겨 붙이기(wave 2) → 되살리기와 gallery(wave 3) → 문서(lead).
- 시작 조건: 계획 `workspace-float`이 main에 land한 뒤. 그 전에는 README만 있다. land하면 planner가 `wrap-plan`으로 float를 닫고, worker 하나에게 실제 코드로 brief를 쓰게 한 뒤 lead를 띄운다.

## 정한 것

- brief를 지금 쓰지 않는다(agent). layout model과 view-order를 `workspace-float`이 바꾸므로, 지금 path로 쓴 소유와 할 일이 틀어진다.

## lead가 할 일

- 끝나면:
  - `project-docs/architecture/workspace-layout.md`에 detached, layout 소유, transfer를 더한다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다.
  - `project-docs/products/roadmap/workspace-float.md`를 지운다(남은 몫이 없다).
- 사람에게 묻는 것: 창 여럿을 띄우는 Electron test를 새로 만들 때.
