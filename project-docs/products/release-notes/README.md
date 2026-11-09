# release-notes

lophn을 쓰는 사람이 읽는 판마다의 요약이다. 외부 공개용이라 영어로 쓴다. 내부 결정과 이유는 `project-docs/products/change-log/`에 있다.

file 하나가 release 하나다: `<x.y.z>.md`. 지난 release 뒤의 change-log 항목에서 사람이 겪는 것만 고른다.

```markdown
# lophn 0.24.0

<One or two sentences on what this release is about.>

## New
- <What a person can now do, in user terms.>

## Changed
- <Behavior that works differently now.>

## Fixed
- <Bug a person could hit, described by its symptom.>

## Action needed
- <What a person must do after updating: rebuild an app, sign in again, ...>
```

- 사람이 보는 이름(Home, project, app, Agents tab, Settings)으로 쓴다. file path, 함수, route, module, 내부 ID, task와 계획 이름은 쓰지 않는다.
- 비어 있는 절은 뺀다.
