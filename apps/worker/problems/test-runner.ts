// test runner control의 진입점이다. RequestTest 실행 구현(problems/tests#R13–R21, 실제 test 자식은
// 요청마다 띄운다)은 runner-core.ts와 app-test-run.ts에 있고, 상시 service(core 감독이 띄운 process가
// `problems.test.run`·`problems.test.recover` 요청, `problems.work` 깨움(problems#T19)과
// `problems.closing` 깨움(problems#T20)을 받는다)은 runner-service.ts에 있다. credential은 argv에
// 넣지 않는다.
export * from "./runner-core.ts";

// runner가 app test 한 건을 직접 돌리는 모드다. launch spec의 권한 그대로 `--app-test-job`으로 띄우면
// stdin의 요청 JSON 한 개를 돌려 결과 JSON을 stdout 한 줄로 낸다(요청을 받는 감독 통로가 이어지기 전의
// 진입점이다). 판정은 stdout 문구가 아니라 자식의 관측 frame이 정한다.
if (import.meta.main && Deno.args.includes("--app-test-job")) {
  const { runAppTestJob } = await import("./app-test-run.ts");
  const text = await new Response(Deno.stdin.readable).text();
  const done = await runAppTestJob(JSON.parse(text));
  Deno.stdout.writeSync(new TextEncoder().encode(`${JSON.stringify(done)}\n`));
  Deno.exit(0);
}

// reproduction test 한 건을 같은 방식으로 돈다(before·after를 차례로 실행한다). 요청 JSON은
// `reproduction-run.ts`의 `ReproductionJob`이다.
if (import.meta.main && Deno.args.includes("--reproduction-job")) {
  const { runReproductionJob } = await import("./reproduction-run.ts");
  const text = await new Response(Deno.stdin.readable).text();
  const done = await runReproductionJob(JSON.parse(text));
  Deno.stdout.writeSync(new TextEncoder().encode(`${JSON.stringify(done)}\n`));
  Deno.exit(0);
}

// 그 밖의 기동은 core 감독이 띄운 상시 process다. session 하나(runner-service.ts)가
// `problems.test.run`·`problems.test.recover` 요청(problems/tests), `problems.work` 깨움
// (problems#T19)과 `problems.closing` 깨움(problems#T20)을 같이 받는다(stdin 하나).
if (
  import.meta.main && !Deno.args.includes("--app-test-job") &&
  !Deno.args.includes("--reproduction-job")
) {
  const { runRunnerService } = await import("./runner-service.ts");
  await runRunnerService();
}
