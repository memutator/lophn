# eval

eval 층(`tests/eval`, `project-docs/architecture/eval.md`)의 열린 이슈.

## 월말정리 Operator가 앱이 아니라 앱 옆 project에 놓인다

```yaml
kind: bug
modules: [tests]
```

지금: `tests/eval/materials/operators-home/4/files/operators.json`의 월말정리는 place `{project: "ledger-project"}`다. `ledger-project`는 `restoreAppProject`(`tests/eval/restore/apps.ts`)가 앱 옆에 만든 보통 project이고 domain이 없다. `restoreOperators`(`tests/eval/restore/operators.ts`)는 place로 project만 받는다. 그래서 가계부 앱을 맡아 일하는 Operator가 그 앱의 domain을 맡지 않는다(`project-docs/architecture/domain.md`: Operator는 정의의 domains ∩ 그릇의 active domain을 맡는다). O4, O7, T19-op은 이 Operator로 "앱 bug를 그 앱의 App Engineer에게 맡기나"를 잰다.

영향: 제품에서 앱을 맡은 Operator는 그 앱 place에 놓여 앱의 domain과 비공개 tool을 받는다. eval의 월말정리는 place 정보에 가계부 앱이 없고 앱 tool도 받지 않아, 재는 판단이 제품의 Operator와 다른 context에서 나온다. run 결과가 지침을 고칠 근거로 약하다.

고치려면:
- `operators-home@5`에서 월말정리를 `{app: "가계부"}`에 두고, `restoreOperators`가 app place를 `world.apps`로 풀며, `OP_월말정리`의 place와 operator 시나리오 넷의 n을 올린다(중간. 재료 새 판과 시나리오 넷의 run 이력이 끊긴다). 추천.
- 그대로 두고 시나리오 머리 주석에 한계를 적는다(작음. 재는 context가 제품과 계속 다르다).
