import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createFixtureRoot(testContext, prefix = "changefleet-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  testContext.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

export async function createGitRepository(
  parent,
  name,
  { harness = false } = {},
) {
  const repositoryPath = path.join(parent, name);
  await mkdir(repositoryPath, { recursive: true });
  await git(repositoryPath, ["init", "-b", "main"]);
  await git(repositoryPath, ["config", "user.name", "Fixture"]);
  await git(repositoryPath, ["config", "user.email", "fixture@example.test"]);
  await writeFile(
    path.join(repositoryPath, "baseline.txt"),
    `${name} committed baseline\n`,
    "utf8",
  );
  if (harness) {
    await writeFile(
      path.join(repositoryPath, "AGENTS.md"),
      `# ${name} Harness\n\nKeep changes deterministic.\n`,
      "utf8",
    );
  }
  await git(repositoryPath, ["add", "-A"]);
  await git(repositoryPath, ["commit", "-m", "baseline"]);
  return {
    name,
    path: repositoryPath,
    base_sha: (await git(repositoryPath, ["rev-parse", "HEAD"])).trim(),
  };
}

export async function writeCombinedCheckScript(parent, candidateCount = 2) {
  const scriptPath = path.join(parent, "combined-check.mjs");
  await writeFile(
    scriptPath,
    [
      'import { readFile } from "node:fs/promises";',
      "",
      "const manifestPath = process.env.CHANGEFLEET_VALIDATION_MANIFEST;",
      "if (!manifestPath) throw new Error('missing manifest');",
      "const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));",
      `if (manifest.candidates.length !== ${candidateCount}) throw new Error('unexpected candidate count');`,
      "for (const candidate of manifest.candidates) {",
      "  const feature = await readFile(`${candidate.workspace_path}/feature.txt`, 'utf8');",
      "  if (!feature.includes(candidate.repository_id)) throw new Error(`wrong feature for ${candidate.repository_id}`);",
      "}",
      "process.stdout.write(`validated:${manifest.validation_subject_hash}\\n`);",
      "",
    ].join("\n"),
    "utf8",
  );
  return scriptPath;
}

export async function git(cwd, arguments_) {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export function readText(filePath) {
  return readFile(filePath, "utf8");
}
