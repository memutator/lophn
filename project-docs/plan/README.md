# 계획

계획 하나가 폴더 하나다: `project-docs/plan/<계획>/`. 여러 계획이 같이 열려 있을 수 있고, 끝난 계획은 폴더째 지운다(기록은 git과 change-log에 남는다). 돌리는 절차는 `.claude/skills/orchestrate/SKILL.md`, task brief 꼴은 `.claude/skills/orchestrate/brief-template.md`가 정한다.

## 계획 폴더

| file | 쓰임 |
|---|---|
| `<계획>/README.md` | 그 계획의 목표, 재료, 범위 밖, 단위, 순서(wave), 사람이 정할 것, 돌리기 전에, lead가 할 일 |
| `<계획>/status.md` | task마다 wave, 선행, 상태, branch, commit. `tools/status.py <계획> build`가 만들고 lead만 고친다 |
| `<계획>/tasks/<id>.md` | worker에게 넘기는 brief. task 하나에 file 하나. `status.py`가 "단위", "선행", "소유" 줄을 읽는다 |
| 그 밖 | 계획마다 필요한 재료(예: 분류 표). 계획이 끝나면 같이 지운다 |

`tools/`는 모든 계획이 같이 쓴다: `status.py <계획> build | ready | set`(상태 표, 띄울 task 고르기), `lead/`(`lead.sh <계획>`, `pick.py <계획> N`, `launch.sh <계획> <id>…`, `prompt.py <계획> <id> <branch>`, `merge.sh <계획> <id>`, `land.sh <계획>`, `main-merge.sh <branch>`, `boot.sh`).

lead는 main checkout에서 일하지 않는다. 계획마다 branch `plan/<계획>`의 worktree(`lead.sh`가 연다)에서 task를 합치고, 계획이 끝날 때 `land.sh`로 main에 올린다(중간 land의 조건은 orchestrate skill "merge").

## 새 계획의 README

- 목표: <무엇을 어떻게 바꾸는가. 한두 문장>
- 재료: `project-docs/products/roadmap/<주제>.md`, `project-docs/issues/<id>.yaml`의 `decided`, `project-docs/architecture/<topic>.md`, `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- 범위 밖: <하지 않는 것>
- 단위: <단위 이름과 범위. 단위마다 소유 path는 brief의 "소유"가 정한다>
- 순서: <wave마다 하는 일과 열리는 조건>
- 사람이 정할 것: <제품 동작, 비용, 되돌리기 비싼 것만. 요구나 원칙으로 답이 나오는 것은 lead가 정하고 근거를 적는다>
- lead가 할 일: <merge 때마다, 다 끝났을 때 고칠 문서>

## 규칙

- task를 나누는 크기, 소유, 병렬 규칙, review, merge는 orchestrate skill을 따른다.
- task id는 계획을 건너서도 하나다. worktree와 branch 이름이 task id로 만들어진다(`status.py build`가 겹치면 멈춘다).
- 계획 둘이 같이 돌면 `status.py ready`가 다른 계획의 running task와 소유가 겹치는 task를 내지 않는다.
- 끝남 기준은 task마다 brief의 "끝남"이 정한다. 기본은 `deno task check` 통과, 위험 test(`write-test`), 죽은 코드·TODO·옛 이름이 없음이다.
- worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `issue` skill대로 `project-docs/issues/`의 이슈가 된다.
- 계획이 끝나면 change-log 항목(`products/change-log/<x.y>/<id>.yaml`. 판은 branch에서 보이는 판으로 쓴다. PATCH는 land가 올린다)을 쓰고 계획 폴더를 지운다. 남은 이슈는 다음 계획의 재료다.
