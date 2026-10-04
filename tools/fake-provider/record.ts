// 별도 사람 명령. stdin: {"body": <captured synthetic fixture>, "secrets": [<memory scan values>]}.
// 실행: LOPHN_LIVE_PROVIDER=1 deno run --allow-env=LOPHN_LIVE_PROVIDER tools/fake-provider/record.ts
// stdout의 safe 결과는 사람이 diff 검토한 뒤에만 채택한다. network 호출은 없다.
import { recordFixture } from "./record-gate.ts";

if (import.meta.main) {
  const live = Deno.env.get("LOPHN_LIVE_PROVIDER") === "1";
  const raw = await new Response(Deno.stdin.readable).text();
  let envelope: { body: unknown; secrets: string[] };
  try {
    const value = JSON.parse(raw);
    if (
      !value || typeof value !== "object" || Array.isArray(value) ||
      !Object.hasOwn(value, "body") || !Array.isArray(value.secrets) ||
      value.secrets.some((item: unknown) => typeof item !== "string") ||
      Object.keys(value).some((key) => key !== "body" && key !== "secrets")
    ) {
      throw new Error();
    }
    envelope = value;
  } catch {
    console.error("record: invalid_envelope");
    Deno.exit(1);
  }
  const result = recordFixture({ live, instructed: true, ...envelope });
  if (!result.ok) {
    console.error(`record: ${result.reason}`);
    Deno.exit(1);
  }
  console.log(JSON.stringify(result.body));
}
