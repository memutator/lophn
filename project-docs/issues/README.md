# issues

열린 문제와 닫은 문제의 목록이다. 이슈 하나가 file 하나(`<id>.yaml`)다. 언제 올리고 닫는지는 `.claude/skills/issue/SKILL.md`가 정한다. 목록은 `node tools/records.ts issues [--topic <t>] [--status open]`.

```yaml
id: provider-id-overwrite      # file 이름과 같다. kebab-case. 바꾸지 않는다
title: 이미 있는 provider id로 연결하면 그 provider의 key·token이 덮인다
kind: bug                      # bug | defect | mistake
status: open                   # open | fixed | kept
topic: agent-definition        # architecture 문서 이름이 있으면 그것. 그 밖: shell, platform, code-health, mistakes, planning
modules: [packages/core/lophn-agent, packages/shell/renderer]   # module-catalog path
now: |                         # 지금: 어디서 어떻게 되나. file과 함수, 재현
  ...
impact: |                      # 영향: 누가 무엇을 잃나
  ...
fix: |                         # 고치려면: 안마다 비용, 추천
  ...
decide: |                      # 정할 것: 사람만 고를 수 있는 것(선택)
decided: |                     # 정한 것: 정할 것이 풀리면 이리로 옮긴다(선택)
cause: |                       # mistake만: 지침이 없었나, 틀렸나, 안 실렸나
prevent: |                     # mistake만: check나 바꿀 문장과 그 자리
closed: |                      # status가 fixed·kept일 때: 무엇을 고쳤나, kept면 남기는 이유
guard: 없음                    # status가 fixed·kept일 때: 다시 생기면 잡는 test나 check 이름, 없으면 없음
regressed: |                   # 다시 생김: 앞서 어떻게 닫았나, 이번에 무엇이 같나(선택)
```

- 필수: `id`, `title`, `kind`, `status`, `topic`, `modules`, `now`, `impact`. open이면 `fix`. fixed·kept면 `closed`, `guard`. mistake면 `cause`, `prevent`.
- 닫기는 `status`를 바꾸고 `closed`·`guard`를 채운다. file을 옮기거나 지우지 않는다. fixed는 같은 변경에서 change-log 항목을 남긴다.
- 다시 생기면 `status: open`으로 되돌리고 `regressed`를 쓴다.
- 찾은 날과 닫은 날은 git log가 안다. 날짜, task id, commit hash를 쓰지 않는다.
- `node tools/records.ts check`가 칸과 `modules`를 본다(`npm run check`의 records 단계).
