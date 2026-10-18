// `deno task eval`의 진입. 진짜 provider를 부르므로 ANTHROPIC_API_KEY가 있을 때만 trial을 돈다.
import { main } from "./runner/cli.ts";

Deno.exit(await main(Deno.args));
