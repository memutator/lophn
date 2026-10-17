<!--
주제 하나에 파일 하나: <topic>.md. 이슈 하나는 ## 절 하나다. 여기 있는 절이 지금 열린 이슈 전부다.
주제 이름은 project-docs/architecture/<topic>.md와 같으면 같은 이름을 쓴다. 그 밖: contexts, shell, platform,
code-health, mistakes. 닫은 이슈는 archived/<topic>.md에 있다.

kind
- bug: 동작이 틀리거나 아직 안 된다.
- defect: 동작은 맞는데 코드에 결함이 있다(숨은 의존, 중복, 죽은 장치, 가장 단순한 구현보다 무거움).
- mistake: worker가 크게 잘못했다. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

yaml block
- kind: 위 셋 중 하나
- modules: 걸린 module-catalog path. mistake는 고칠 context나 check의 module(tools 등)도 적는다
- 찾은 날은 git log로 본다

본문
- 지금: 어디서 어떻게 되나. 파일과 함수, 재현.
- 영향: 누가 무엇을 잃나(데이터, 권한, 화면, 개발 비용). defect면 이대로 두면 무엇이 비싸지나.
- 고치려면: 안마다 비용. 추천을 밝힌다.
- 정할 것: 사람이 골라야 하는 것. 없으면 줄을 두지 않는다.
- 정한 것: 사람이 정한 방향. 정할 것이 풀리면 이 줄로 바꾼다. 고칠 때 이대로 한다.
- mistake만: 원인(지침이 없었나, 틀렸나, context에 안 실렸나), 막기(check로 잡을 수 있으면 check).

닫기: 절을 archived/<topic>.md 끝으로 옮긴다. archived는 append-only다.
- yaml block에 closed(fixed | kept)와 guard(다시 생기면 잡는 test나 check 이름, 없으면 없음)를 더한다.
- 본문 끝에 닫음: 무엇을 고쳤나. kept면 남기는 이유.
- 고친 것은 같은 변경에서 changelog 열린 판에 남긴다.

다시 생김(회귀): archived에서 절을 찾아 열린 파일로 되돌리고 "다시 생김: 앞서 어떻게 닫았나" 줄을 더한다.
- bug가 다시 생기면 이번에 고칠 때 test를 쓴다(AGENTS.md "두 번 이상 고친 버그").
- mistake가 다시 생기면 문장으로 막은 것이 실패한 것이다. check로 막는다.
- guard가 없음인 닫힌 이슈가 회귀 후보다.
-->
# <topic>

<이 주제가 다루는 것 한 줄. architecture 문서가 있으면 그 path.>

## <이슈 한 줄>

```yaml
kind: bug
modules: [packages/core/apps]
```

지금:

영향:

고치려면:

정할 것:
