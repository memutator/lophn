# contexts

project의 context(계약 bundle, 초안, 목차, 위반)와 project 검색. architecture 문서는 아직 없다.

## md가 아닌 문서는 context로 쓸 수 없다

```yaml
kind: bug
modules: [packages/core/projects, packages/protocol]
```

지금: context 계약의 목차는 markdown 제목에서만 나온다(`protocol/projects/context-contract.ts`의 outline source). pdf·docs 같은 문서는 목차 기반 개체를 만들 수 없어 context로 쓸 수 없다. 예전에 PM이 목차를 직접 적어 두는 저장 목차(`outline.set` route, agent tool, `outlines/` 폴더)를 만들었지만 읽는 쪽(계약 형식, context worker 요청)이 없어 지웠다.

영향: 사람이 pdf·docs로 가진 규정이나 문서를 PM이 context로 관리하지 못한다. md로 바꿔 넣어야 한다.

고치려면: 실제로 md 아닌 문서를 context로 써야 할 때 계약부터 다시 설계한다. 목차를 누가 만드는지(PM이 적기, 문서에서 뽑기), 계약의 형식 칸, context worker 요청과 snapshot에 목차를 싣는 길을 같이 정한다. 지운 저장 목차를 되살리지 않는다.

정한 것: 지금 만들지 않는다. 필요해지면 위대로 다시 만든다.
