# 계획

계획 하나의 꼴이다. 새 계획을 세울 때 이 file을 그 계획의 개요로 고쳐 쓰고, 나머지는 비운 채로 둔다. 돌리는 절차는 `.claude/skills/orchestrate/SKILL.md`, task brief 꼴은 `.claude/skills/orchestrate/brief-template.md`가 정한다.

## 무엇을 두나

| file | 쓰임 |
|---|---|
| `README.md` | 이 계획의 목표, 단위, 순서(wave), 사람이 정할 것 |
| `status.md` | task마다 wave, 선행, 상태, branch, commit. `tools/status.py`가 만들고 lead만 고친다 |
| `tasks/<id>.md` | worker에게 넘기는 brief. task 하나에 file 하나 |
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
- worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `project-docs/issues/`의 이슈가 된다.
- 계획이 끝나면 task brief와 `status.md`를 비우고, changelog의 열린 판에 항목을 덧붙인다. 남은 이슈는 다음 계획의 재료다.
