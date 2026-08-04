import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = process.argv[2] ? [process.argv[2]] : ["chromium", "gecko"];
const validTargets = new Set(["chromium", "gecko"]);

for (const target of targets) {
  if (!validTargets.has(target)) {
    throw new Error(`Unknown build target "${target}". Expected chromium or gecko.`);
  }
}

for (const target of targets) {
  const outdir = path.join(root, "dist", target);
  const manifestPath = path.join(root, "manifests", `${target}.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  await writeFile(path.join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Gecko's XPI installer validates sourceMappingURL references and throws
  // NS_ERROR_FILE_NOT_FOUND if the .map files can't be resolved from inside the XPI.
  // Disable sourcemaps for Gecko to avoid this.
  const sourcemap = target === "chromium" ? true : false;

  await esbuild.build({
    entryPoints: {
      background: path.join(root, "src", "background", "index.ts"),
      popup: path.join(root, "src", "popup", "popup.ts")
    },
    bundle: true,
    sourcemap,
    format: "iife",
    target: ["chrome120", "firefox120"],
    define: {
      __BROWSER_TARGET__: JSON.stringify(target)
    },
    outdir
  });

  const popupHtml = await readFile(path.join(root, "src", "popup", "popup.html"), "utf8");
  await writeFile(path.join(outdir, "popup.html"), popupHtml.replace("./popup.ts", "./popup.js"));
  await copyFile(path.join(root, "src", "popup", "popup.css"), path.join(outdir, "popup.css"));
  await copyFile(path.join(root, "src", "assets", "icon.png"), path.join(outdir, "icon.png"));

  if (target === "gecko") {
    console.log(`Built gecko extension in dist/gecko`);
    console.log(`  → To install: open about:debugging → This Firefox → Load Temporary Add-on → select dist/gecko/manifest.json`);
  } else {
    console.log(`Built chromium extension in dist/chromium`);
    console.log(`  → To install: open chrome://extensions (or brave://extensions, edge://extensions) → Developer mode ON → Load unpacked → select dist/chromium`);
  }
}
