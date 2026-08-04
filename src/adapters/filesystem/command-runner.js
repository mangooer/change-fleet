import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import crossSpawn from "cross-spawn";

import { ChangeFleetError } from "../../domain/errors.js";

// 调用方只能提供 executable 与 argv；Windows batch 解析交给固定适配器，绝不接受 shell 字符串。
const MAX_CAPTURE_BYTES = 1024 * 1024;
const WINDOWS_BATCH_EXTENSIONS = new Set([".cmd", ".bat"]);

export async function runCommand(
  command,
  { cwd, environment = {}, signal = undefined } = {},
) {
  const effectiveEnvironment = {
    ...process.env,
    ...environment,
  };
  const resolvedExecutable = await resolveExecutable(command.executable, {
    cwd,
    environment: effectiveEnvironment,
  });
  const adapter =
    process.platform === "win32" &&
    WINDOWS_BATCH_EXTENSIONS.has(path.extname(resolvedExecutable).toLowerCase())
      ? "windows_batch"
      : "direct";

  return new Promise((resolve, reject) => {
    // cross-spawn 只接收结构化参数；它内部处理 npm.cmd 一类 shim 的双重 cmd 转义。
    const child = crossSpawn(resolvedExecutable, command.argv, {
      cwd,
      env: effectiveEnvironment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let terminationRequested = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, command.timeout_ms);
    const abort = () => {
      cancelled = true;
      terminateChild();
    };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }

    child.stdout?.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_CAPTURE_BYTES) stdout.push(chunk);
      else {
        overflow = true;
        terminateChild();
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_CAPTURE_BYTES) stderr.push(chunk);
      else {
        overflow = true;
        terminateChild();
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const commandResult = resultFor({ code: null, exitSignal: null });
      reject(
        new ChangeFleetError(
          "COMMAND_SPAWN_FAILED",
          `Failed to start ${command.command_id}: ${error.message}`,
          {
            command_id: command.command_id,
            requested_executable: command.executable,
            resolved_executable: resolvedExecutable,
            adapter,
            spawn_error_code: error.code ?? null,
            command_result: commandResult,
          },
        ),
      );
    });
    child.once("close", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(resultFor({ code, exitSignal }));
    });

    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }

    function terminateChild() {
      if (terminationRequested) return;
      terminationRequested = true;
      if (
        process.platform === "win32" &&
        adapter === "windows_batch" &&
        Number.isSafeInteger(child.pid)
      ) {
        // cmd shim 会再启动真实程序；按本次精确 PID 杀树，避免只关闭外层后留下孤儿进程。
        const killer = crossSpawn(
          "taskkill.exe",
          ["/pid", String(child.pid), "/t", "/f"],
          {
            shell: false,
            windowsHide: true,
            stdio: "ignore",
          },
        );
        killer.once("error", () => child.kill());
        return;
      }
      child.kill();
    }

    function resultFor({ code, exitSignal }) {
      return {
        command_id: command.command_id,
        executable: command.executable,
        argv: [...command.argv],
        requested_executable: command.executable,
        resolved_executable: resolvedExecutable,
        adapter,
        // spawnfile/spawnargs 反映实际 native 或 cmd 适配调用，但不包含环境变量和值。
        effective_invocation: {
          executable: child.spawnfile ?? resolvedExecutable,
          argv: Array.isArray(child.spawnargs)
            ? child.spawnargs.slice(1)
            : [...command.argv],
        },
        exit_code: code,
        signal: exitSignal,
        timed_out: timedOut,
        cancelled,
        output_overflow: overflow,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
    }
  });
}

async function resolveExecutable(executable, { cwd, environment }) {
  const hasDirectory = /[\\/]/u.test(executable);
  const roots = hasDirectory
    ? [path.isAbsolute(executable) ? "" : (cwd ?? process.cwd())]
    : executableSearchRoots(environment);
  const extensions = executableExtensions(executable, environment);
  for (const root of roots) {
    for (const extension of extensions) {
      const candidate = hasDirectory
        ? path.resolve(root, `${executable}${extension}`)
        : path.join(root, `${executable}${extension}`);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  // 保留原始值让 spawn 产生结构化 ENOENT，不能用 shell 或隐式回退猜测命令。
  return executable;
}

function executableSearchRoots(environment) {
  const pathValue =
    environment.PATH ?? environment.Path ?? environment.path ?? "";
  return String(pathValue)
    .split(path.delimiter)
    .map((item) => item.replace(/^"|"$/gu, "").trim())
    .filter(Boolean);
}

function executableExtensions(executable, environment) {
  if (process.platform !== "win32" || path.extname(executable)) return [""];
  const pathExt = environment.PATHEXT ?? environment.PathExt;
  return String(pathExt ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function isExecutableFile(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
