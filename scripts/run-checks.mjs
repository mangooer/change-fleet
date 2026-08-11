import { spawn } from "node:child_process";

import { unsupportedNodeVersionDiagnostic } from "./node-version-guard.mjs";

const checks = [
  ["scripts/check-harness.mjs"],
  ["--test", "test/unit/**/*.test.js"],
  // Real-Git 文件级并发有界，避免 Windows 进程树停止测试被大量同时启动的 Git 子进程饿死。
  ["--test", "--test-concurrency=4", "test/integration/**/*.test.js"],
  ["--test", "--test-concurrency=1", "test/acceptance/**/*.test.js"],
  ["scripts/run-ui-tests.mjs"],
];

const nodeVersionDiagnostic = unsupportedNodeVersionDiagnostic(
  process.versions.node,
);
if (nodeVersionDiagnostic !== null) {
  // 在派发任何测试前失败，避免错误运行时消耗完整套件时间并产生误导性结果。
  process.stderr.write(
    `[${nodeVersionDiagnostic.code}] ${nodeVersionDiagnostic.message}\n`,
  );
  process.exitCode = 1;
} else {
  for (const arguments_ of checks) {
    const exitCode = await run(process.execPath, arguments_);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      break;
    }
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
