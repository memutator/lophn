# annotation (닫음)

## annotation command 넷과 ref 표, 24시간 sweep, 1시간 유예

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: `AnnotationPersist/Discard/AddRefs/Sweep` command 넷(`core/apps/annotations/commands.ts`), `annotation_batches`·`annotations`·`annotation_refs` 표, 하루 한 번 sweep(`retention.ts`), 방금 보낸 묶음의 1시간 유예(`SWEEP_GRACE_MS`)가 있다. `annotations.send`는 memory route라 ledger를 못 써서 사람 자격으로 command를 다시 낸다. session 메시지와 ticket이 `addRef`/`removeRefs`로 ref를 붙이고 뗀다.

영향: annotation 하나를 남기고 지우는 데 command, 표, ref, sweep, 유예가 모두 걸려 있다. ticket과 session 메시지 쪽 코드도 ref를 관리해야 한다.

고치려면:
- annotation을 메시지 본문에만 남기고 표·sweep을 없앤다. ticket 근거가 annotation을 직접 가리키지 않으니 coding agent가 `ticket show`로 screenshot 경로를 받는 길(`AnnotationLookup`)이 사라지거나 ticket이 값을 복사해 가져야 한다(큼).
- 남긴다. ticket 근거를 값으로 풀어 주는 일에는 표가 필요하다.
- 추천: 남긴다. 줄이려면 먼저 coding agent가 annotation을 받는 길을 정한다.

닫음: 남긴다. coding agent가 `ticket show`로 annotation과 screenshot 경로를 받는 길이 이 표를 쓴다.
