// (e) A backend.js that throws while it evaluates. The host runs backend.js wrapped in try/catch, so the guest ends as
// `failed fatal` and the phone app lives.
throw new Error("backend evaluation threw");
