import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUSES = new Set([
  "draft",
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
  "canceled",
]);
const REQUIRED_FIELDS = [
  "artifact_type",
  "id",
  "status",
  "title",
  "source",
  "confirmed_by",
  "confirmed_at",
];
const NON_EMPTY_FIELDS = new Set([
  "artifact_type",
  "id",
  "status",
  "title",
  "source",
]);
const EAGER_LIMITS = [
  ["AGENTS.md", 6 * 1024],
  ["WORKFLOW.md", 2 * 1024],
  ["docs/current-state.md", 8 * 1024],
];

// 该入口只检查 ChangeFleet 仓库自身，不接受或推断任何注册仓库规则。
export async function checkRepositoryHarness(repositoryRoot = DEFAULT_ROOT) {
  const root = path.resolve(repositoryRoot);
  const violations = [];
  let eagerFileCount = 0;

  for (const [relativePath, maximumBytes] of EAGER_LIMITS) {
    let metadata;
    try {
      metadata = await stat(path.join(root, relativePath));
      eagerFileCount += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      add(violations, "MISSING_EAGER_HARNESS_FILE", relativePath, "Required file is missing.");
      continue;
    }
    if (!metadata.isFile()) {
      add(violations, "INVALID_EAGER_HARNESS_FILE", relativePath, "Expected a regular file.");
    } else if (metadata.size > maximumBytes) {
      add(
        violations,
        "EAGER_HARNESS_SIZE_EXCEEDED",
        relativePath,
        `Observed ${metadata.size} bytes; maximum is ${maximumBytes}.`,
      );
    }
  }

  const workItemsPath = path.join(root, "docs", "work-items");
  let entries = [];
  try {
    entries = await readdir(workItemsPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    add(
      violations,
      "MISSING_WORK_ITEM_DIRECTORY",
      "docs/work-items",
      "Development WorkItem directory is missing.",
    );
  }
  const names = entries
    .filter((entry) => entry.isFile() && /^WI-.*\.md$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    add(
      violations,
      "MISSING_WORK_ITEMS",
      "docs/work-items",
      "At least one Development WorkItem is required.",
    );
  }

  for (const name of names) {
    const relativePath = `docs/work-items/${name}`;
    const contents = await readFile(path.join(workItemsPath, name), "utf8");
    inspectWorkItem(contents, name, relativePath, violations);
  }
  return { repositoryRoot: root, eagerFileCount, workItemCount: names.length, violations };
}

function inspectWorkItem(contents, fileName, relativePath, violations) {
  const fields = topLevelFrontmatter(contents);
  if (fields === null) {
    add(
      violations,
      "INVALID_WORK_ITEM_FRONTMATTER",
      relativePath,
      "Expected bounded frontmatter with opening and closing delimiters.",
    );
    return;
  }
  for (const field of REQUIRED_FIELDS) {
    if (!fields.has(field)) {
      add(violations, "MISSING_WORK_ITEM_FIELD", relativePath, `Missing field: ${field}.`);
    } else if (NON_EMPTY_FIELDS.has(field) && fields.get(field).length === 0) {
      add(violations, "EMPTY_WORK_ITEM_FIELD", relativePath, `Empty field: ${field}.`);
    }
  }
  if (fields.get("artifact_type") !== "development_work_item") {
    add(
      violations,
      "INVALID_WORK_ITEM_ARTIFACT_TYPE",
      relativePath,
      "artifact_type must be development_work_item.",
    );
  }
  const expectedId = fileName.match(/^(WI-\d{4})(?:-.+)?\.md$/u)?.[1];
  if (!expectedId) {
    add(
      violations,
      "INVALID_WORK_ITEM_FILE_NAME",
      relativePath,
      "Filename must begin with WI followed by four digits.",
    );
  } else if (fields.get("id") !== expectedId) {
    add(
      violations,
      "WORK_ITEM_ID_MISMATCH",
      relativePath,
      `Frontmatter id must match ${expectedId}.`,
    );
  }
  if (fields.has("status") && !STATUSES.has(fields.get("status"))) {
    add(
      violations,
      "INVALID_WORK_ITEM_STATUS",
      relativePath,
      `Unsupported status: ${fields.get("status")}.`,
    );
  }
  // draft 尚未获得执行授权，其他状态必须保留确认身份和时间。
  if (fields.get("status") !== "draft") {
    for (const field of ["confirmed_by", "confirmed_at"]) {
      if (fields.has(field) && fields.get(field).length === 0) {
        add(
          violations,
          "MISSING_WORK_ITEM_CONFIRMATION",
          relativePath,
          `Empty confirmation field: ${field}.`,
        );
      }
    }
  }
}

function topLevelFrontmatter(contents) {
  const lines = contents.split(/\r?\n/u);
  const closingIndex = lines.indexOf("---", 1);
  if (lines[0] !== "---" || closingIndex === -1) return null;
  const fields = new Map();
  // 缩进内容属于合法 YAML 子结构；这里仅拥有并读取稳定的顶层标量。
  for (const line of lines.slice(1, closingIndex)) {
    if (line.length === 0 || /^\s/u.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return fields;
}

function add(violations, code, relativePath, message) {
  violations.push({ code, path: relativePath, message });
}

async function runCli() {
  const result = await checkRepositoryHarness();
  if (result.violations.length > 0) {
    process.stderr.write(
      `ChangeFleet repository Harness check failed:\n${result.violations
        .map((item) => `- [${item.code}] ${item.path}: ${item.message}`)
        .join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `ChangeFleet repository Harness check passed: ${result.eagerFileCount} eager files, ${result.workItemCount} WorkItems.\n`,
  );
}

// 测试导入模块时不执行命令入口。
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
