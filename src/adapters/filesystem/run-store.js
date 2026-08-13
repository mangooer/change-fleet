import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { canonicalStringify } from "../../domain/canonical-json.js";
import { invariant } from "../../domain/errors.js";
import {
  assertAgentRunLifecycle,
  assertAgentRunTransition,
} from "../../domain/lifecycle.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";

// RunStore 保存一次 Runtime 尝试及有界事件流，ChangeSet 中只保留 Run 引用。
const INLINE_STRING_BYTES = 8 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;

export class RunStore {
  constructor(controlRoot) {
    this.runsRoot = path.join(path.resolve(controlRoot), "runs");
  }

  async initialize() {
    await mkdir(this.runsRoot, { recursive: true });
  }

  async create(run) {
    assertAgentRunLifecycle(run);
    const runDirectory = this.runDirectory(run.run_id);
    await mkdir(path.join(runDirectory, "artifacts"), { recursive: true });
    const existing = await readJsonFile(this.runPath(run.run_id), {
      allowMissing: true,
    });
    invariant(
      !existing,
      "RUN_ALREADY_EXISTS",
      `Run ${run.run_id} already exists`,
    );
    await writeJsonFileAtomic(this.runPath(run.run_id), run);
    await this.appendEvent(run.run_id, {
      event_id: randomUUID(),
      type: "run.created",
      at: run.created_at,
      payload: {
        operation: run.operation,
        attempt: run.attempt,
      },
    });
  }

  async read(runId) {
    return readJsonFile(this.runPath(runId));
  }

  async readEvents(runId, { type = null, limit = 64, tail = false } = {}) {
    // UI 查询只流式筛选所需事件；不会一次性加载完整事件日志，也不会借此暴露原始 Run。
    invariant(
      type === null || (typeof type === "string" && type.length > 0),
      "INVALID_RUN_EVENT_QUERY",
      "Run event type filter is invalid",
    );
    invariant(
      Number.isSafeInteger(limit) && limit >= 1 && limit <= 256,
      "INVALID_RUN_EVENT_QUERY",
      "Run event query limit is invalid",
    );
    invariant(
      typeof tail === "boolean",
      "INVALID_RUN_EVENT_QUERY",
      "Run event tail selector is invalid",
    );
    const events = [];
    const input = createReadStream(
      path.join(this.runDirectory(runId), "events.jsonl"),
      { encoding: "utf8" },
    );
    const lines = createInterface({
      input,
      crlfDelay: Infinity,
    });
    try {
      for await (const line of lines) {
        if (line.length === 0) continue;
        const event = JSON.parse(line);
        if (type !== null && event.type !== type) continue;
        events.push(event);
        if (!tail && events.length >= limit) break;
        if (tail && events.length > limit) events.shift();
      }
    } finally {
      lines.close();
      input.destroy();
    }
    return events;
  }

  async update(runId, mutator) {
    const run = await this.read(runId);
    const previous = structuredClone(run);
    const result = await mutator(run);
    assertAgentRunTransition(previous, run);
    await writeJsonFileAtomic(this.runPath(runId), run);
    return result;
  }

  async appendEvent(runId, event) {
    // 超大字符串先外置，保证单行 JSONL 不会无限挤占恢复和审计开销。
    const normalized = await this.externalize(runId, event);
    const line = `${canonicalStringify(normalized)}\n`;
    invariant(
      Buffer.byteLength(line) <= MAX_EVENT_BYTES,
      "RUN_EVENT_TOO_LARGE",
      `Run event remains larger than ${MAX_EVENT_BYTES} bytes after externalization`,
    );
    await appendFile(
      path.join(this.runDirectory(runId), "events.jsonl"),
      line,
      "utf8",
    );
  }

  async writeJsonArtifact(runId, label, value) {
    // 对话正文等语义证据单独保存；ChangeSet 聚合只持有经过哈希校验的引用。
    invariant(
      typeof label === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(label),
      "INVALID_ARTIFACT_LABEL",
      "Run artifact label is invalid",
    );
    const content = `${canonicalStringify(value)}\n`;
    const hash = createHash("sha256").update(content).digest("hex");
    const relativePath = `artifacts/${label}-${hash}.json`;
    await writeIfMissing(
      path.join(this.runDirectory(runId), relativePath),
      content,
    );
    return {
      run_id: runId,
      artifact_ref: relativePath,
      sha256: hash,
      bytes: Buffer.byteLength(content),
    };
  }

  async readJsonArtifact(reference) {
    invariant(
      reference && typeof reference === "object",
      "INVALID_ARTIFACT_REFERENCE",
      "Run artifact reference is required",
    );
    const runId = reference.run_id;
    const relativePath = reference.artifact_ref;
    const artifactsRoot = path.join(this.runDirectory(runId), "artifacts");
    const resolved = path.resolve(this.runDirectory(runId), relativePath);
    invariant(
      typeof relativePath === "string" &&
        resolved.startsWith(`${path.resolve(artifactsRoot)}${path.sep}`),
      "INVALID_ARTIFACT_REFERENCE",
      "Run artifact reference must remain inside the Run artifacts directory",
    );
    const content = await readFile(resolved, "utf8");
    invariant(
      createHash("sha256").update(content).digest("hex") === reference.sha256,
      "ARTIFACT_DIGEST_MISMATCH",
      "Run artifact content does not match its recorded digest",
    );
    return JSON.parse(content);
  }

  async externalize(runId, value, pathParts = []) {
    if (typeof value === "string") {
      if (Buffer.byteLength(value) <= INLINE_STRING_BYTES) return value;
      const hash = createHash("sha256").update(value).digest("hex");
      const artifactPath = path.join(
        this.runDirectory(runId),
        "artifacts",
        `${hash}.txt`,
      );
      await writeIfMissing(artifactPath, value);
      return {
        artifact_ref: `artifacts/${hash}.txt`,
        sha256: hash,
        bytes: Buffer.byteLength(value),
        preview: value.slice(0, 2_048),
        field_path: pathParts.join("."),
      };
    }
    if (Array.isArray(value)) {
      return Promise.all(
        value.map((item, index) =>
          this.externalize(runId, item, [...pathParts, String(index)]),
        ),
      );
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = await this.externalize(runId, item, [
          ...pathParts,
          key,
        ]);
      }
      return result;
    }
    return value;
  }

  runDirectory(runId) {
    return path.join(this.runsRoot, runId);
  }

  runPath(runId) {
    return path.join(this.runDirectory(runId), "run.json");
  }
}

async function writeIfMissing(filePath, content) {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(filePath, "utf8");
    invariant(
      existing === content,
      "ARTIFACT_HASH_COLLISION",
      `Artifact path ${filePath} already contains different content`,
    );
  }
}
