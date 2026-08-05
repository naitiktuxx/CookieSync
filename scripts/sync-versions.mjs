import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function syncVersions() {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const newVersion = pkg.version;

  console.log(`Syncing version v${newVersion} across manifest files...`);

  for (const target of ["chromium", "gecko"]) {
    const manifestPath = path.join(root, "manifests", `${target}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    
    if (manifest.version !== newVersion) {
      manifest.version = newVersion;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
      console.log(`  Updated manifests/${target}.json -> v${newVersion}`);
    } else {
      console.log(`  manifests/${target}.json is already v${newVersion}`);
    }
  }
}

syncVersions().catch((err) => {
  console.error("Version sync failed:", err);
  process.exit(1);
});
