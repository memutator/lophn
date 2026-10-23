# dg-kit-guide

kit으로 node를 그리는 법을 `guide-artifact` skill로 옮기고, domain에서 무엇을 그릴지(kind 지도, 상태 흐름)와 그리기 전에 묻는다는 것을 쓴다.

- 단위: skills (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/skills/guide-artifact/SKILL.md`
  - `packages/core/agent-roles/skills/guide-workflows/SKILL.md`
  - `packages/core/agent-roles/skills/kinds-yaml/SKILL.md`
  - `project-docs/architecture/ui-kit.md`
- 읽을 것:
  - 계획: `project-docs/plan/domain-graph/README.md`의 "정한 것"
  - skill: 위 셋 전부. `guide-workflows`의 "Artifacts are optional: ask"와 "Drawing nodes with the kit"
  - architecture: `project-docs/architecture/ui-kit.md` "artifact에 닿는 길", `project-docs/architecture/artifact.md`(봉한 view, 폴더 밖을 읽지 못함)
  - 코드: `packages/shell/renderer/artifact-kit/`(`LophnKit.renderGraph`가 받는 모양과 tone 값), `packages/protocol/projects/kinds-file.ts`(`ref`, `enum` 칸), `packages/core/agent-roles/tools/kind.ts`(`kind.list`의 `aggregate`, `group_by`)
- 계약:
  - 쓰는 것: `LophnKit.renderGraph(element, { nodes, edges })`, node `{ id, label, status?: { label, tone }, note? }`, edge `{ from, to, label? }`. 바꾸지 않는다.
  - 내놓는 것: 없음.

## 할 일

1. `guide-artifact/SKILL.md`에 "Drawing nodes with the kit" 절을 옮겨 온다. 지금 `guide-workflows`의 글(불러오는 `<script>`와 stylesheet, `renderGraph`, node와 edge 모양, tone 값, 크기가 0이 아닌 block)을 그대로 쓰고, 설명을 workflow와 domain 둘 다에 맞게 고친다. 실제 kit code와 다른 곳이 있으면 code를 따르고 보고한다.
2. 같은 skill에 "Drawing a domain" 절을 쓴다:
   - 그리기 전에 그림이 필요한지 `ask`로 묻는다. 없다는 답도 좋은 답이다.
   - kind 지도: kind가 node, `ref` 칸이 edge(label은 칸 이름). item 수는 `kind.list`의 `aggregate` count로 세어 note에 둘 수 있다.
   - 상태 흐름: 상태를 뜻하는 `enum` 칸이 있으면 값이 node, 값마다 item 수(`group_by`)를 note에 둔다. 값 사이 순서는 `DOMAIN.md`나 사람의 말에서 오고, 모르면 edge 없이 그린다.
   - artifact는 `kinds.yaml`을 읽지 못하므로 agent가 그림 data를 `data/*.json`에 쓴다. 짧은 HTML 예 하나(kind 지도).
   - Operator는 kind 파일을 쓰지 않지만, 받은 domain의 artifact에 같은 그림을 그릴 수 있다.
3. `guide-workflows/SKILL.md`의 "Drawing nodes with the kit"에서 kit 쓰는 법(불러오기, API, 모양, tone)을 지우고 "`guide-artifact`의 'Drawing nodes with the kit'을 따른다"로 가리킨다. workflow에만 걸린 것(static artifact는 HTML에 step을 바로 쓴다, instance artifact의 `data/_instance.json`, 전체 page reload, 예 HTML)은 남긴다. PM은 두 skill을 다 받는다.
4. `kinds-yaml/SKILL.md`에 한 줄: kind 지도 artifact가 있으면 kind 파일을 바꿀 때 그 data도 고친다.
5. `project-docs/architecture/ui-kit.md` "artifact에 닿는 길"의 "쓰는 법은 지금 PM skill `guide-workflows`에만 있다"를 `guide-artifact`로 고친다.

## 끝남

- `deno task check`가 통과한다(skill 글은 eval 버전 hash에 들어가 `tests/eval` 쪽 check가 바뀐 component를 알린다. 통과하면 그대로 둔다).
- 위험 test: 없음
- 남지 않음: `guide-workflows/SKILL.md`에 `renderGraph`의 node·edge 모양 설명이 없다(가리키는 줄과 예 HTML만 남는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
