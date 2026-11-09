# change-log

무엇이 왜 바뀌었고 무엇을 정했는지의 내부 기록이다. 일(계획 하나, 단독 수정 하나) 하나가 항목 file 하나다. 사람이 읽는 외부 요약은 `project-docs/products/release-notes/`다.

자리: `change-log/<major>.<minor>/<id>.yaml`. 목록은 `node tools/records.ts changes [--version <x.y>]`.

```yaml
id: flow-catalog               # file 이름과 같다. kebab-case
version: 0.22.3                # 이 일이 main에 올라간 판. 폴더의 major.minor와 같다
title: flow catalog로 모든 동작과 test가 덮는 outcome을 적는다
modules: [tools, packages/protocol]   # 일 전체의 diff에서 동작이나 계약이 바뀐 module-catalog path. 결정만이면 []
checked: [boundary-catalog]    # change_reasons가 걸려 봤지만 고칠 것이 없던 registry ID(선택)
change: |                      # 무엇이 바뀌었나. 동작, 계약(route, event, schema, tool), 저장 모양의 전과 후를 짧게
  ...
why: |                         # 이 변경을 한 이유
  ...
decisions:                     # 정한 것. 버린 길과 그 이유를 같은 글에
  - text: entry는 code에서 뽑고 commit하지 않는다. 버린 길: 손으로 적기(다시 셀 수 없다).
    by: agent                  # person | agent. 사람이 정하지 않고 추천안으로 진행했으면 agent
follow_up: |                   # 이 변경 때문에 다른 쪽이 할 일(선택)
checklist:                     # 설치한 앱에서 사람이 할 것·볼 것(선택). 비지 않은 글의 목록
  - "해야: 앱을 다시 build한다"          # `해야:`로 시작하면 설치 체크리스트의 "해야 할 것"
  - Home의 + menu에 Agents가 보이는지 본다  # 그 밖은 "확인할 것"
```

- 필수: `id`, `version`, `title`, `modules`, `change`, `why`. `decisions`는 결정이 있을 때.
- `checklist`: 사람이 설치한 앱에서 해야 하거나 눈으로 확인할 것이 있을 때 land하는 agent가 쓴다(없으면 칸을 두지 않는다). `node tools/install-checklist.ts [--from <x.y.z>]`가 깔린 판과 설치할 판 사이 항목의 `checklist`와 release notes의 "Action needed"로 markdown checklist를 만든다. `npm run package`도 `<out>/install-checklist.md`로 낸다. 옛 항목은 채우지 않는다.
- 쓰는 때: 동작·계약·저장 모양이 바뀌었을 때, 결정이 있었을 때. 동작이 같은 리팩터링, 주석, test 정리, 포맷은 쓰지 않는다.
- 항목은 그 일의 마지막 commit에 넣는다. 올라간 항목은 고치지 않는다. 틀렸으면 바로잡는 항목을 새로 쓴다.

## 판

제품 판은 root `package.json`의 `version` 하나다. 그것이 지금 main의 판이다.

- PATCH: 제품 code(`packages/`)를 바꾼 일 하나를 main에 올릴 때 도구(`land.sh`, `main-merge.sh`)가 main 판의 PATCH를 올린다. branch는 `package.json`의 판을 고치지 않는다. 항목은 branch에서 보이는 판(`package.json`의 판)으로 쓰면 되고, 도구가 올릴 때 그 branch가 더한 항목의 `version`을 새 판으로 고치고 폴더를 옮겨 "Release <판>" commit 하나로 남긴다. `packages/`를 안 바꾼 일은 main 판 그대로다. 그래서 판 줄과 항목 폴더로 rebase가 부딪히지 않는다. 계획 하나가 land를 여러 번 하면 land마다 PATCH가 오른다.
- MINOR·MAJOR: 사람이 정한다. 사람이 release를 말하면 agent가 main에서(main lock을 잡고 직접 commit) 판을 올리고(`x.(y+1).0`) 지난 release 뒤 항목들로 `release-notes/<판>.md` 초안을 쓰고, 사람이 확인하면 tag `v<판>`을 단다.
- `node tools/records.ts check`: `package.json` 판의 항목이 있어야 하고, 그보다 높은 판의 항목이 없어야 한다.
