import { spawn } from "node:child_process";

const checks = [
  ["--test", "test/unit/**/*.test.js"],
  ["--test", "test/integration/**/*.test.js"],
  ["--test", "--test-concurrency=1", "test/acceptance/**/*.test.js"],
];

for (const arguments_ of checks) {
  const exitCode = await run(process.execPath, arguments_);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}

function run(executable, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Check terminated by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
