// (b) A screen file that throws while it evaluates without the build's try/catch: the error reaches React Native's own
// handler before the guest has one (the path that ended the whole app in the spike).
throw new Error("top-level throw outside the screen build's try/catch");
