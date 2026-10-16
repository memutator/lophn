# 계획

계획 하나의 꼴이다. 새 계획을 세울 때 이 file을 그 계획의 개요로 고쳐 쓰고, 나머지는 비운 채로 둔다. 돌리는 절차는 `.claude/skills/orchestrate/SKILL.md`, task brief 꼴은 `.claude/skills/orchestrate/brief-template.md`가 정한다.

## 무엇을 두나

| file | 쓰임 |
|---|---|
| `README.md` | 이 계획의 목표, 단위, 순서(wave), 사람이 정할 것 |
| `status.md` | task마다 wave, 선행, 상태, branch, commit. `tools/status.py`가 만들고 lead만 고친다 |
| `tasks/<id>.md` | worker에게 넘기는 brief. task 하나에 file 하나 |
| `weight.md` | worker가 가장 단순한 구현보다 무겁게 짠 곳. lead가 보고에서 덧붙인다 |
| `gaps.md` | 알려진 미완 동작. lead가 보고에서 덧붙인다 |
| `tools/` | `status.py`(상태 표, 띄울 task 고르기), `lead/`(launch, prompt, merge, boot) |

## 이 계획 (새 계획마다 채운다)

- 목표: <무엇을 어떻게 바꾸는가. 한두 문장>
- 재료: `project-docs/PRODUCT.md`, `project-docs/architecture/<topic>.md`, `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`, `tools/wireframes`
- 단위: <단위 이름과 범위. 단위마다 소유 path는 brief의 "소유"가 정한다>
- 순서: <wave마다 하는 일과 열리는 조건>
- 사람이 정할 것: <제품 동작, 비용, 되돌리기 비싼 것만>

## 규칙

- task를 나누는 크기, 소유, 병렬 규칙, review, merge는 orchestrate skill을 따른다.
- 끝남 기준은 task마다 brief의 "끝남"이 정한다. 기본은 `deno task check` 통과, 위험 test(`write-test`), 죽은 코드·TODO·옛 이름이 없음이다.
- `weight.md`는 사람이 항목을 보고 줄일지 정한다. 줄이기로 하면 diet task로 옮기고 항목을 지운다. 남기기로 하면 이유를 그 자리 주석으로 옮기고 항목을 지운다.
- `gaps.md`는 고치면 항목을 지운다.
- 계획이 끝나면 task brief와 `status.md`를 비운다. 남은 `weight.md`와 `gaps.md`는 다음 계획의 재료다.
