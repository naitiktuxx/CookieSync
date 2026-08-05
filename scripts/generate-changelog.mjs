import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function getGitCommits() {
  try {
    let range = "";
    try {
      const lastTag = execSync("git describe --tags --abbrev=0 HEAD^ 2>/dev/null", {
        encoding: "utf8"
      }).trim();
      if (lastTag) {
        range = `${lastTag}..HEAD`;
      }
    } catch {
      // If no previous tag, range remains empty to fetch commit history
    }

    const logOutput = execSync(`git log ${range} --no-merges --pretty=format:"%s"`, {
      encoding: "utf8",
      cwd: root
    }).trim();

    return logOutput ? logOutput.split("\n") : [];
  } catch (err) {
    console.warn("Could not retrieve git commits:", err.message);
    return [];
  }
}

export async function generateChangelog() {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  let version = process.env.TAG_VERSION || pkg.version;
  if (version.startsWith("v")) {
    version = version.slice(1);
  }

  const commits = getGitCommits();

  const added = [];
  const changed = [];
  const fixed = [];
  const security = [];

  for (const rawMsg of commits) {
    const msg = rawMsg.trim();
    if (!msg) continue;
    const lower = msg.toLowerCase();

    if (lower.startsWith("feat") || lower.startsWith("add") || lower.includes("feature")) {
      added.push(msg.replace(/^(feat|add)(\([^\)]+\))?:\s*/i, ""));
    } else if (lower.startsWith("fix") || lower.includes("bug")) {
      fixed.push(msg.replace(/^fix(\([^\)]+\))?:\s*/i, ""));
    } else if (lower.startsWith("sec") || lower.includes("security") || lower.includes("deps")) {
      security.push(msg.replace(/^(sec|security)(\([^\)]+\))?:\s*/i, ""));
    } else {
      changed.push(msg.replace(/^(chore|refactor|docs|style|test)(\([^\)]+\))?:\s*/i, ""));
    }
  }

  let changelog = `# CookieSync v${version}\n\n`;

  if (version === "0.1.1") {
    changelog += `## Fixed
- Fixed Mozilla Add-on Validator requirements.
- Added required Firefox data_collection_permissions.
- Added properly sized extension icons.
- Replaced unsafe innerHTML usage with DOM APIs.
- Improved release packaging.

## Changed
- Improved Firefox compatibility.
- Improved release validation.
- Updated build pipeline.

`;
  } else {
    if (added.length > 0) {
      changelog += "## Added\n";
      added.forEach((item) => (changelog += `- ${item}\n`));
      changelog += "\n";
    }

    if (changed.length > 0) {
      changelog += "## Changed\n";
      changed.forEach((item) => (changelog += `- ${item}\n`));
      changelog += "\n";
    }

    if (fixed.length > 0) {
      changelog += "## Fixed\n";
      fixed.forEach((item) => (changelog += `- ${item}\n`));
      changelog += "\n";
    }

    if (security.length > 0) {
      changelog += "## Security\n";
      security.forEach((item) => (changelog += `- ${item}\n`));
      changelog += "\n";
    }
  }

  changelog += "## Downloads\n";
  changelog += `- CookieSync-Chromium-Host-v${version}.zip\n`;
  changelog += `- CookieSync-Firefox-Receiver-v${version}.xpi\n`;
  changelog += `- SHA256SUMS.txt\n`;

  const outputPath = path.join(root, "RELEASE_NOTES.md");
  await writeFile(outputPath, changelog, "utf8");
  console.log(`Generated release notes at ${outputPath}`);
  return changelog;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateChangelog().catch((err) => {
    console.error("Changelog generation failed:", err);
    process.exit(1);
  });
}
