// problems/tests#R20 fixture. 상한보다 큰 메모리를 잡고 페이지를 커밋한다.
// 예약만 하면 cgroup이 세지 않는다. 상한이 걸리면 이 프로세스는 여기서 죽는다.
const chunks: Uint8Array[] = [];
const step = 32 * 1024 * 1024;
const target = 900 * 1024 * 1024;
let held = 0;
while (held < target) {
  const block = new Uint8Array(step);
  for (let offset = 0; offset < block.length; offset += 4096) block[offset] = 1;
  chunks.push(block);
  held += step;
}
console.log("survived");
