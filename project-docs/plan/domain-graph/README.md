# domain-graph: domain artifact에서도 node 그림을 쓴다

- **목표:** workflow의 node 그림 방식을 domain에도 쓴다(사람, 2026-10-22). kit(`_lophn/kit.js`의 `LophnKit.renderGraph`)은 모든 artifact view에 이미 있다. 남은 것은 domain artifact를 쓰는 agent가 그 쓰는 법과 무엇을 그릴지를 아는 것이다.
- **재료:**
  - roadmap `project-docs/products/roadmap/domain.md` "node 시각화"
  - architecture `project-docs/architecture/ui-kit.md` "artifact에 닿는 길", `project-docs/architecture/artifact.md`
  - skill: `packages/core/agent-roles/skills/guide-artifact/SKILL.md`(PM, App Engineer, Operator), `guide-workflows/SKILL.md`의 "Drawing nodes with the kit"(지금 kit 쓰는 법이 여기에만 있다), `kinds-yaml/SKILL.md`
  - kind 파일의 `ref` 칸(`packages/protocol/projects/kinds-file.ts`, `type: ref`, `to: <kind>`)
- **범위 밖:**
  - program이 domain 그림을 저절로 그리기. 그림은 domain 주인 agent가 artifact로 그린다. workflow artifact를 PM이 그리는 것과 같다.
  - kit 부품 바꾸기. `GraphDiagram`은 그대로 쓴다.
- **돌리는 방식:** worker(`sonnet-high`) 하나. task id는 `dg-`로 시작한다.
- **시작 조건:** 없다. `flow-sandbox`의 task도 `guide-workflows/SKILL.md`를 고쳐서 둘이 같이 돌지는 않는다(`status.py ready`가 거른다).

## 정한 것

- **kit 쓰는 법은 `guide-artifact`로 옮긴다(agent, planner).** domain artifact를 쓰는 세 role이 모두 받는 skill이다. `guide-workflows`에는 workflow에만 걸린 것(static과 instance artifact, `data/_instance.json`, 물어보기)을 남기고 kit 쓰는 법은 `guide-artifact`를 가리킨다. 같은 API 설명이 두 곳에 있으면 갈라진다.
- **domain에서 그리는 것은 둘이다(agent, planner).**
  - kind 지도: kind가 node, `ref` 칸이 edge(label은 칸 이름)다. kind마다 item 수를 `kind.list`의 `aggregate`(count)로 세어 node의 note에 둘 수 있다. kind 파일에 이미 있는 것이라 그대로 그린다.
  - 상태 흐름: kind에 상태를 뜻하는 `enum` 칸이 있으면 값이 node이고 값마다 item 수(`group_by`)를 note에 둔다. 값 사이의 순서(edge)는 그 domain의 뜻이라 agent가 `DOMAIN.md`나 사람의 말로 정하고, 모르면 edge 없이 그린다.
- **그리기 전에 묻는다(agent, planner).** workflow artifact와 같다. 그림이 필요한지 사람에게 `ask`로 묻고, 없다는 답도 좋은 답이다. 이것은 사람이 2026-10-22 workflow에 정한 것("모든 workflow에 필요한 것은 아니다. PM이 물어보면 된다")을 domain에 그대로 쓴 것이다.
- **kind 지도는 kind 파일을 바꾼 agent가 같이 고친다(agent, planner).** artifact는 자기 폴더 밖(`kinds.yaml`)을 읽지 못하므로 그림의 data(`data/*.json`)를 agent가 쓴다. `kinds-yaml` skill에 "kind 지도 artifact가 있으면 data도 고친다"를 한 줄 둔다.

## 위험 test

없다. skill 글과 문서만 바뀐다.

## lead가 할 일

- 다 끝나면 `project-docs/architecture/ui-kit.md`의 "쓰는 법은 지금 PM skill `guide-workflows`에만 있다"를 고치고, roadmap `domain.md` "node 시각화"를 지우고, changelog 열린 판 `project-docs/products/change-log/0.8.0.md`에 항목을 쓰고, 계획 폴더를 지운다.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것" 전부. 그 밖은 planner에게 묻는다.
