# task brief 꼴

task 하나에 file 하나다: `project-docs/plan/<계획>/tasks/<id>.md`. worker는 이 file과 AGENTS.md만 보고 일을 끝낼 수 있어야 한다. lead가 쓴다.

## 이름과 크기

- id는 `<단위>-<하는 일>`(소문자 영어, `-`)이다. 계획을 건너서도 하나여야 한다(worktree·branch 이름). 단위에 task가 하나면 단위 이름 그대로 쓴다. 번호, wave, 단계 이름을 넣지 않는다.
- worker 하나가 한 session에 끝낼 크기로 나눈다.
- 같은 wave에서 소유 path가 겹치는 task는 선행으로 순서를 정한다. 서로 기대지 않는 task는 선행을 두지 않는다.

## 꼴

```markdown
# <task id>

<무엇을 하는지 한두 문장>

- 단위: <단위> (wave <N>)
- 선행: <task id, ...> | 없음
- 소유(이 task만 고친다):
  - `<path>`
- 읽을 것:
  - architecture: `project-docs/architecture/<topic>.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `<boundary ID>`, `project-docs/module-catalog.yaml`의 `<module ID>`
  - 본보기(화면): `tools/wireframes/frames/<frame>`
  - 제품 결정: `project-docs/PRODUCT.md`의 <절>
- 계약:
  - 쓰는 것: <고정된 protocol, port, IPC의 file과 이름>
  - 내놓는 것: <다른 task가 기대는 것. 계약 task는 모양(type, 칸, route·event 이름)을 여기에 적는다>

## 할 일

1. <순서대로. 지울 것, 고칠 것, 새로 만들 것을 file과 이름으로 적는다>

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "<결과 한 문장>" | 없음
- 남지 않음: `grep -rn "<옛 이름>" packages tools`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `<page>`가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
```

## brief를 쓸 때 지킬 것

- 읽을 것은 파일과 ID로 가리킨다. 할 일마다 근거(architecture topic, boundary·module ID)를 붙인다. 문서에 없는 일을 만들지 않는다. 필요하면 "정한 것"으로 적고 이유를 쓴다.
- 소유는 지금 코드를 열어 확인한 실제 path다. 다른 task의 소유와 겹치지 않는다. `{a,b}` 중괄호 묶음은 `status.py`가 풀어 읽는다.
- 선행 줄은 첫 문장에 task id만 쓴다(`status.py`가 첫 마침표까지만 읽는다). 설명은 그 뒤에 쓴다.
- 계약 task의 brief는 모양을 적는다. 옛 계약은 지우지 않고 새것을 옆에 더한다(옛것을 쓰는 곳이 남아 있다). 옛것은 구현 task와 cleanup이 지운다.
- 화면 task의 brief는 wireframe 코드를 옮기게 한다. 보고 다시 그리지 않는다. wireframe file과 갈 renderer 위치를 짝지어 적고, 가짜 data를 대신할 source와 박아 둔 글을 바꿀 wording key 영역을 적는다.
- 위험 test는 `write-test` skill 기준이다. 화면, 문구, 내부 구현은 test하지 않는다.
- 말: 개발자 영어 단어를 그대로 쓴다. 뜻을 옮긴 번역어(장부, 가림, 시험)를 새로 만들지 않는다.
