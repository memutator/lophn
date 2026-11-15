# @lophn/cap-problem 1.1.0

Previous: 1.0.0
Breaking: no.

The package now has a phone entry (`exports` with the `lophn-phone` condition) so the same backend can run on the phone. The Node-only exception observer stays on the computer's entry; `reportProblem` is the same on both.

Change the same version in `package.json` (`file:.lophn/sdk/cap-problem/1.1.0`) and in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.
