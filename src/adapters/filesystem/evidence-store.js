import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalStringify, sha256, stableId } from "../../domain/canonical-json.js";
import { invariant } from "../../domain/errors.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";

// Evidence 按内容寻址且不可变，大输出外置为 artifact，聚合状态只保存引用。
const INLINE_OUTPUT_BYTES = 8 * 1024;

export class EvidenceStore {
  constructor(controlRoot) {
    this.evidenceRoot = path.join(path.resolve(controlRoot), "evidence");
    this.artifactsRoot = path.join(this.evidenceRoot, "artifacts");
  }

  async initialize() {
    await mkdir(this.artifactsRoot, { recursive: true });
  }

  async record({ kind, subject, payload, createdAt }) {
    const boundedPayload = await this.externalize(payload);
    const content = {
      schema_version: 1,
      kind,
      subject,
      payload: boundedPayload,
      created_at: createdAt,
    };
    const evidenceHash = sha256(content);
    const evidenceId = stableId("evidence", {
      kind,
      subject,
      evidenceHash,
    });
    const record = {
      ...content,
      evidence_id: evidenceId,
      evidence_hash: evidenceHash,
    };
    const filePath = path.join(this.evidenceRoot, `${evidenceId}.json`);
    const existing = await readJsonFile(filePath, { allowMissing: true });
    if (existing) {
      invariant(
        existing.evidence_hash === evidenceHash,
        "IMMUTABLE_EVIDENCE_CONFLICT",
        `Evidence ${evidenceId} already contains different content`,
      );
    } else {
      await writeJsonFileAtomic(filePath, record);
    }
    return {
      evidence_id: evidenceId,
      evidence_hash: evidenceHash,
      kind,
    };
  }

  async read(evidenceId) {
    return readJsonFile(path.join(this.evidenceRoot, `${evidenceId}.json`));
  }

  async externalize(value) {
    if (typeof value === "string") {
      if (Buffer.byteLength(value) <= INLINE_OUTPUT_BYTES) return value;
      const hash = sha256(value);
      const filePath = path.join(this.artifactsRoot, `${hash}.txt`);
      await writeIfMissing(filePath, value);
      return {
        artifact_ref: `artifacts/${hash}.txt`,
        sha256: hash,
        bytes: Buffer.byteLength(value),
        preview: value.slice(0, 2_048),
      };
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.externalize(item)));
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = await this.externalize(item);
      }
      return result;
    }
    return value;
  }
}

async function writeIfMissing(filePath, content) {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    invariant(
      (await readFile(filePath, "utf8")) === content,
      "ARTIFACT_HASH_COLLISION",
      `Artifact path ${filePath} already contains different content`,
    );
  }
}
