import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateChangelog } from "./generate-changelog.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function createZipArchive(sourceDir, targetZipPath) {
  try {
    const archiverModule = await import("archiver");
    const archiver = archiverModule.default || archiverModule;
    const { createWriteStream } = await import("node:fs");

    return await new Promise((resolve, reject) => {
      const output = createWriteStream(targetZipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => resolve());
      output.on("error", (err) => reject(err));
      archive.on("error", (err) => reject(err));

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  } catch {
    // Fallback to cross-platform OS native commands (Windows PowerShell Compress-Archive, Linux/macOS zip)
    if (process.platform === "win32") {
      const psCommand = `powershell -NoProfile -NonInteractive -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${targetZipPath}' -Force"`;
      execSync(psCommand, { stdio: "inherit" });
    } else {
      execSync(`cd "${sourceDir}" && zip -r "${targetZipPath}" .`, {
        shell: true,
        stdio: "inherit"
      });
    }
  }
}

async function main() {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  
  let version = process.env.TAG_VERSION || pkg.version;
  if (version.startsWith("v")) {
    version = version.slice(1);
  }

  // Validate manifest versions match expected version
  for (const target of ["chromium", "gecko"]) {
    const manifestPath = path.join(root, "manifests", `${target}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.version !== version) {
      throw new Error(
        `Version mismatch: manifests/${target}.json version (${manifest.version}) does not match expected version (${version}).`
      );
    }
  }

  console.log(`Building release artifacts for version v${version}...`);
  execSync("node scripts/build.mjs", { cwd: root, stdio: "inherit" });

  const chromiumZip = `CookieSync-Chromium-Host-v${version}.zip`;
  const firefoxXpi = `CookieSync-Firefox-Receiver-v${version}.xpi`;

  // Remove existing output artifacts if present
  await rm(path.join(root, chromiumZip), { force: true });
  await rm(path.join(root, firefoxXpi), { force: true });
  await rm(path.join(root, "SHA256SUMS.txt"), { force: true });

  console.log(`Packaging ${chromiumZip} (cross-platform)...`);
  await createZipArchive(path.join(root, "dist", "chromium"), path.join(root, chromiumZip));

  console.log(`Packaging ${firefoxXpi} (cross-platform)...`);
  await createZipArchive(path.join(root, "dist", "gecko"), path.join(root, firefoxXpi));

  const filesToHash = [chromiumZip, firefoxXpi];
  const checksumLines = [];

  for (const filename of filesToHash) {
    const filePath = path.join(root, filename);
    const content = await readFile(filePath);
    const hash = createHash("sha256").update(content).digest("hex");
    checksumLines.push(`${hash}  ${filename}`);
  }

  const checksumContent = checksumLines.join("\n") + "\n";
  await writeFile(path.join(root, "SHA256SUMS.txt"), checksumContent, "utf8");

  console.log("\nSHA256SUMS.txt generated successfully:");
  console.log(checksumContent);

  console.log("Generating release notes from commits...");
  await generateChangelog();

  console.log("Package completed successfully!");
}

main().catch((err) => {
  console.error("Packaging failed:", err);
  process.exit(1);
});
