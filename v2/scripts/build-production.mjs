import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { addCanonical, assertPreviewRobots, canonicalOutput, filesBelow, removePreviewElements, repositoryRoot, sha256, sourceFiles, sourceManifest } from "./release-utils.mjs";

const args = process.argv.slice(2);
let preview = false;
let requestedOutput;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--preview" && !preview) preview = true;
  else if (args[index] === "--out" && requestedOutput === undefined && args[index + 1] && !args[index + 1].startsWith("--")) requestedOutput = args[++index];
  else throw new Error("Usage: node scripts/build-production.mjs [--preview] [--out /absolute/dedicated/output]");
}
const kind = preview ? "preview" : "production";
const output = await canonicalOutput(requestedOutput || `/workspace/exports/shadowbridge-v2-${kind}`);
const relative = path.relative(repositoryRoot, output);
if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..") || output === path.parse(output).root || output === "/workspace" || output === "/tmp") {
  throw new Error("Production output must be a dedicated directory outside the checkout.");
}
const manifestName = ".shadowbridge-build.json";
let existing = false;
try {
  const stat = await fs.lstat(output);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing non-directory or symlink output: ${output}`);
  existing = true;
  const manifest = JSON.parse(await fs.readFile(path.join(output, manifestName), "utf8"));
  if (manifest.format !== "shadowbridge-v2-artifact-v1" || manifest.kind !== kind || !manifest.outputs) throw new Error("Existing output is not owned by this build mode.");
  const files = (await filesBelow(output)).map((file) => path.relative(output, file).split(path.sep).join("/"));
  for (const name of files) {
    if (name === manifestName) continue;
    if (!Object.hasOwn(manifest.outputs, name)) throw new Error(`Preserving unrelated output file; use a new output directory: ${name}`);
    if (sha256(await fs.readFile(path.join(output, name))) !== manifest.outputs[name]) throw new Error(`Preserving modified generated file; use a new output directory: ${name}`);
  }
  if (files.length !== Object.keys(manifest.outputs).length + 1) throw new Error("Existing output is incomplete; use a new output directory.");
} catch (error) {
  if (error.code !== "ENOENT" || existing) throw error;
}

const sources = await sourceFiles();
const generated = new Map();
for (const [name, buffer] of sources) {
  if (name.startsWith("assets/")) generated.set(name, buffer);
}
for (const [name, canonical] of [["index.html", "https://shadow-bridge.eu/"], ["cartel/index.html", "https://shadow-bridge.eu/cartel/"]]) {
  let html = sources.get(name).toString("utf8");
  assertPreviewRobots(html, name);
  if (preview) {
    if (html.split("<!-- release:canonical -->").length !== 2) throw new Error("Expected one canonical marker per preview source page.");
    html = html.replace("<!-- release:canonical -->", "");
  } else {
    html = addCanonical(removePreviewElements(html), canonical);
    if (name === "index.html") html = html.replace(/(<meta\s+name="robots"\s+content=")noindex, nofollow("\s*\/?\s*>)/i, "$1index, follow$2");
    if (/DESIGN PREVIEW/i.test(html)) throw new Error(`A preview label remains in ${name}. Mark preview-only elements explicitly in the source.`);
  }
  generated.set(name, Buffer.from(html.replace(/[ \t]+$/gm, "")));
}
generated.set("robots.txt", Buffer.from(preview ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\nDisallow: /cartel/\n\nSitemap: https://shadow-bridge.eu/sitemap.xml\n"));
if (!preview) generated.set("sitemap.xml", Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://shadow-bridge.eu/</loc></url></urlset>\n'));
const manifest = sourceManifest(sources, kind);
manifest.outputs = Object.fromEntries([...generated].map(([name, buffer]) => [name, sha256(buffer)]));
generated.set(manifestName, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));

await fs.mkdir(path.dirname(output), { recursive: true });
const stage = `${output}.stage-${randomUUID()}`;
const previous = `${output}.previous-${randomUUID()}`;
await fs.mkdir(stage);
try {
  for (const [name, buffer] of generated) {
    const file = path.join(stage, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer, { flag: "wx" });
  }
  if (existing) await fs.rename(output, previous);
  try {
    await fs.rename(stage, output);
  } catch (error) {
    if (existing) await fs.rename(previous, output);
    throw error;
  }
  if (existing) await fs.rm(previous, { recursive: true });
} catch (error) {
  await fs.rm(stage, { recursive: true, force: true });
  throw error;
}
console.log(`Prepared local ${kind} artifact: ${output}\nFiles: ${generated.size}\nNo deployment, DNS, hosting, Git push or authentication changes were performed.`);
