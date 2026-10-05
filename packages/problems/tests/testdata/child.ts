// runner 격리 확인용 자식. 인자의 경로에 한 줄을 쓴다.
const path = Deno.args[0];
if (!path) Deno.exit(2);
await Deno.writeTextFile(path, "fixture\n");
console.log("ok");
