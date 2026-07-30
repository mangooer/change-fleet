import { spawn } from "node:child_process";

import { ChangeFleetError } from "../../domain/errors.js";

// 验证命令直接执行 executable 与 argv，禁止 shell 拼接，并限制运行时间和输出大小。
const MAX_CAPTURE_BYTES = 1024 * 1024;

export function runCommand(
  command,
  { cwd, environment = {}, signal = undefined } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.argv, {
      cwd,
      env: {
        ...process.env,
        ...environment,
      },
      shell: false,
      windowsHide: true,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, command.timeout_ms);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_CAPTURE_BYTES) stdout.push(chunk);
      else {
        overflow = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_CAPTURE_BYTES) stderr.push(chunk);
      else {
        overflow = true;
        child.kill();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(
        new ChangeFleetError(
          "COMMAND_SPAWN_FAILED",
          `Failed to start ${command.command_id}: ${error.message}`,
          { command_id: command.command_id, executable: command.executable },
        ),
      );
    });
    child.once("exit", (code, exitSignal) => {
      clearTimeout(timeout);
      resolve({
        command_id: command.command_id,
        executable: command.executable,
        argv: [...command.argv],
        exit_code: code,
        signal: exitSignal,
        timed_out: timedOut,
        output_overflow: overflow,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
