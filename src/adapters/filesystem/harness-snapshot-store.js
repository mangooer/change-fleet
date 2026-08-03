import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256, stableId } from "../../domain/canonical-json.js";
import { invariant } from "../../domain/errors.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";

const SNAPSHOT_SCHEMA_VERSION = 1;

export class HarnessSnapshotStore {
  constructor(controlRoot) {
    this.root = path.join(path.resolve(controlRoot), "harness-snapshots");
    this.filesRoot = path.join(this.root, "files");
  }

  async initialize() {
    await mkdir(this.filesRoot, { recursive: true });
  }

  async record({
    repositoryId,
    baseSha,
    providerFamily,
    policyRevision,
    selectorDigest,
    files,
    createdAt,
  }) {
    // 私有 Harness 字节按内容寻址保存；ChangeSet 聚合只持有不可变引用和有界清单。
    const normalizedFiles = [...files]
      .sort((left, right) =>
        left.relative_path.localeCompare(right.relative_path),
      )
      .map((file) => ({
        relative_path: file.relative_path,
        sha256: sha256(file.content),
        bytes: file.content.byteLength,
        executable: Boolean(file.executable),
      }));
    const contentDigest = sha256({ files: normalizedFiles });
    const identity = {
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      repository_id: repositoryId,
      resolved_base_sha: baseSha,
      provider_family: providerFamily,
      workspace_policy_revision: policyRevision,
      selector_digest: selectorDigest,
      content_digest: contentDigest,
      files: normalizedFiles,
    };
    const snapshotHash = sha256(identity);
    const snapshotId = stableId("harness-snapshot", identity);

    for (const file of files) {
      await writeContentIfMissing(
        path.join(this.filesRoot, sha256(file.content)),
        file.content,
      );
    }

    const record = {
      ...identity,
      snapshot_id: snapshotId,
      snapshot_hash: snapshotHash,
      created_at: createdAt,
    };
    const snapshotPath = path.join(this.root, `${snapshotId}.json`);
    const existing = await readJsonFile(snapshotPath, {
      allowMissing: true,
    });
    if (existing) {
      invariant(
        existing.snapshot_hash === snapshotHash,
        "IMMUTABLE_HARNESS_SNAPSHOT_CONFLICT",
        `Harness snapshot ${snapshotId} already contains different content`,
      );
    } else {
      await writeJsonFileAtomic(snapshotPath, record);
    }
    return {
      snapshot_id: snapshotId,
      snapshot_hash: snapshotHash,
      content_digest: contentDigest,
    };
  }

  async read(reference) {
    // 重建前逐层校验引用、清单和每个内容块，任何缺失或篡改都必须关闭执行路径。
    invariant(
      reference &&
        typeof reference.snapshot_id === "string" &&
        typeof reference.snapshot_hash === "string",
      "INVALID_HARNESS_SNAPSHOT_REFERENCE",
      "Harness snapshot reference is required",
    );
    const record = await readJsonFile(
      path.join(this.root, `${reference.snapshot_id}.json`),
    );
    const identity = snapshotIdentity(record);
    invariant(
      record.schema_version === SNAPSHOT_SCHEMA_VERSION &&
        record.snapshot_hash === reference.snapshot_hash &&
        sha256(identity) === record.snapshot_hash &&
        stableId("harness-snapshot", identity) === record.snapshot_id &&
        (reference.content_digest === undefined ||
          reference.content_digest === record.content_digest),
      "HARNESS_SNAPSHOT_IDENTITY_MISMATCH",
      `Harness snapshot ${reference.snapshot_id} failed identity validation`,
    );
    const files = [];
    for (const file of record.files) {
      const content = await readFile(path.join(this.filesRoot, file.sha256));
      invariant(
        content.byteLength === file.bytes && sha256(content) === file.sha256,
        "HARNESS_SNAPSHOT_CONTENT_MISMATCH",
        `Harness snapshot content is invalid for ${file.relative_path}`,
      );
      files.push({ ...file, content });
    }
    return { ...record, files };
  }
}

function snapshotIdentity(record) {
  return {
    schema_version: record.schema_version,
    repository_id: record.repository_id,
    resolved_base_sha: record.resolved_base_sha,
    provider_family: record.provider_family,
    workspace_policy_revision: record.workspace_policy_revision,
    selector_digest: record.selector_digest,
    content_digest: record.content_digest,
    files: record.files,
  };
}

async function writeContentIfMissing(filePath, content) {
  try {
    await writeFile(filePath, content, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(filePath);
    invariant(
      existing.equals(content),
      "HARNESS_SNAPSHOT_CONTENT_COLLISION",
      `Harness content path ${filePath} contains different bytes`,
    );
  }
}
