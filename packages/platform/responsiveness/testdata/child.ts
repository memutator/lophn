// supervisor 테스트가 띄우는 fixture child. 동작은 환경 이름으로 고른다.
const mode = Deno.env.get("LOPHN_FIXTURE_MODE") ?? "normal";

function frame(payload: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const bytes = new Uint8Array(9 + body.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 5 + body.length, false);
  view.setUint8(4, 1);
  view.setUint32(5, 0, false);
  bytes.set(body, 9);
  return bytes;
}

function byteFrame(channel: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(9 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 5 + payload.length, false);
  view.setUint8(4, 2);
  view.setUint32(5, channel, false);
  bytes.set(payload, 9);
  return bytes;
}

async function readHello() {
  const bytes = new Uint8Array(64 * 1024);
  let used = 0;
  while (used < 9) {
    const count = await Deno.stdin.read(bytes.subarray(used));
    if (count === null) return undefined;
    used += count;
  }
  const length = new DataView(bytes.buffer).getUint32(0, false);
  while (used < 4 + length) {
    const count = await Deno.stdin.read(bytes.subarray(used));
    if (count === null) return undefined;
    used += count;
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(9, 4 + length)));
}

if (mode === "junk") {
  const hello = await readHello();
  if (!hello) Deno.exit(0);
  await Deno.stdout.write(new TextEncoder().encode("not a frame\n"));
  Deno.exit(0);
}

if (mode === "die") Deno.exit(2);

if (mode === "grandchild") {
  new Deno.Command("/bin/sleep", {
    args: ["60"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
}

if (mode === "silent") {
  await readHello();
  await new Promise(() => {});
}

const hello = await readHello();
if (!hello) Deno.exit(0);
Deno.stderr.writeSync(
  new TextEncoder().encode(`hello seen for ${hello.kind}\n`),
);
await Deno.stdout.write(frame({ type: "ready" }));

if (mode === "report") {
  await Deno.stdout.write(frame({
    type: "worker_response",
    request_id: "req-1",
    ok: true,
    payload: { echoed: true },
  }));
}

if (mode === "chunk") {
  await Deno.stdout.write(byteFrame(7, new TextEncoder().encode("blob-bytes")));
}

if (mode === "crash") Deno.exit(3);

const rest = new Uint8Array(64 * 1024);
while (true) {
  const count = await Deno.stdin.read(rest);
  if (count === null) break;
  const text = new TextDecoder().decode(rest.subarray(9, count));
  if (text.includes('"stop"')) {
    await Deno.stdout.write(frame({ type: "stopped" }));
    break;
  }
}
