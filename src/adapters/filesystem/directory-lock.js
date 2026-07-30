import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChangeFleetError } from "../../domain/errors.js";

// 锁目录的创建是原子的；owner token 防止旧控制器误释放新控制器持有的锁。
const OWNER_FILE = "owner.json";

export class DirectoryLock {
  constructor(lockPath, owner) {
    this.lockPath = lockPath;
    this.owner = owner;
    this.released = false;
  }

  static async acquire(
    lockPath,
    { ownerType = "operation", ownerId = null, clock = () => new Date() } = {},
  ) {
    await mkdir(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const owner = {
        schema_version: 1,
        token: randomUUID(),
        owner_type: ownerType,
        owner_id: ownerId,
        hostname: os.hostname(),
        pid: process.pid,
        acquired_at: clock().toISOString(),
      };
      try {
        await mkdir(lockPath);
        await writeFile(
          path.join(lockPath, OWNER_FILE),
          `${JSON.stringify(owner, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
        return new DirectoryLock(lockPath, owner);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }

      const existing = await readOwner(lockPath);
      if (existing === null) {
        const lockStat = await stat(lockPath).catch(() => null);
        if (lockStat && Date.now() - lockStat.mtimeMs < 5_000) {
          throw busyError(lockPath, { state: "owner_pending" });
        }
      } else if (!ownerIsProvenDead(existing)) {
        // 远程或未知所有者绝不按超时时间猜测失效，宁可显式阻塞。
        throw busyError(lockPath, existing);
      }

      const quarantine = `${lockPath}.stale.${randomUUID()}`;
      try {
        await rename(lockPath, quarantine);
        await rm(quarantine, { recursive: true, force: true });
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw busyError(lockPath, existing, error);
      }
    }
    throw busyError(lockPath, { state: "acquire_retries_exhausted" });
  }

  async release() {
    // 释放前再次核对 token，避免删除已经转交给其他控制器的锁。
    if (this.released) return;
    const current = await readOwner(this.lockPath);
    if (!current || current.token !== this.owner.token) {
      throw new ChangeFleetError(
        "LOCK_OWNERSHIP_LOST",
        `Cannot release lock not owned by token ${this.owner.token}`,
        { lock_path: this.lockPath, current_owner: current },
      );
    }
    await rm(this.lockPath, { recursive: true, force: true });
    this.released = true;
  }
}

async function readOwner(lockPath) {
  try {
    return JSON.parse(await readFile(path.join(lockPath, OWNER_FILE), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function ownerIsProvenDead(owner) {
  if (
    owner.hostname !== os.hostname() ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0
  ) {
    return false;
  }
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

function busyError(lockPath, owner, cause = undefined) {
  const error = new ChangeFleetError(
    "LOCK_BUSY",
    `Lock is owned or cannot be safely replaced: ${lockPath}`,
    { lock_path: lockPath, owner },
  );
  error.cause = cause;
  return error;
}
