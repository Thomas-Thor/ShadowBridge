import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const v2Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = path.resolve(v2Root, "..");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function filesBelow(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not accepted: ${absolute}`);
    if (entry.isDirectory()) result.push(...await filesBelow(absolute));
    else if (entry.isFile()) result.push(absolute);
    else throw new Error(`Unsupported filesystem entry: ${absolute}`);
  }
  return result.sort();
}

export async function sourceFiles() {
  const names = ["index.html", "cartel/index.html"];
  names.push(...(await filesBelow(path.join(v2Root, "assets"))).map((file) => path.relative(v2Root, file)));
  const result = new Map();
  for (const name of names) {
    const file = path.join(v2Root, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular source file: ${file}`);
    result.set(name.split(path.sep).join("/"), await fs.readFile(file));
  }
  return result;
}

export function sourceManifest(sources, kind) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: repositoryRoot, encoding: "utf8" });
  return {
    format: "shadowbridge-v2-artifact-v1",
    kind,
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    workingTreeExport: status.length > 0,
    sourceDescription: "Source SHA256 values identify the exported bytes; baseCommit alone does not identify uncommitted changes.",
    sources: Object.fromEntries([...sources].map(([name, data]) => [`v2/${name}`, sha256(data)])),
  };
}

export function removePreviewElements(html) {
  const tags = [...html.matchAll(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi)];
  const removals = [];
  for (let index = 0; index < tags.length; index += 1) {
    const token = tags[index];
    if (!/^<[a-z]/i.test(token[0]) || !/\sdata-preview-only(?:\s|=|>)/i.test(token[0])) continue;
    const name = /^<([\w:-]+)/.exec(token[0])[1];
    if (/\/>$/.test(token[0]) || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(name)) {
      removals.push([token.index, token.index + token[0].length]);
      continue;
    }
    let depth = 1;
    let end = index + 1;
    const sameTag = new RegExp(`^<(/?)${name}(?:\\s|>)`, "i");
    for (; end < tags.length; end += 1) {
      const match = sameTag.exec(tags[end][0]);
      if (!match) continue;
      depth += match[1] ? -1 : 1;
      if (depth === 0) break;
    }
    if (depth !== 0) throw new Error(`Unclosed preview-only element: ${name}`);
    removals.push([token.index, tags[end].index + tags[end][0].length]);
    index = end;
  }
  for (const [start, end] of removals.reverse()) html = html.slice(0, start) + html.slice(end);
  if (/data-preview-only/i.test(html)) throw new Error("Unprocessed preview-only markup remains.");
  return html;
}

export function addCanonical(html, url) {
  const marker = "<!-- release:canonical -->";
  if (html.split(marker).length !== 2) throw new Error("Expected exactly one release:canonical marker per source page.");
  if (/<link\b[^>]*rel=["']canonical["']/i.test(html) || /<meta\b[^>]*property=["']og:url["']/i.test(html)) {
    throw new Error("Source canonical/og:url tags would duplicate release metadata.");
  }
  return html.replace(marker, `<link rel="canonical" href="${url}" />\n    <meta property="og:url" content="${url}" />`);
}

export function assertPreviewRobots(html, name) {
  if (!/<meta\s+name="robots"\s+content="noindex, nofollow"\s*\/?\s*>/i.test(html)) {
    throw new Error(`${name} must retain the source preview noindex, nofollow directive.`);
  }
}

export async function atomicWrite(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, { flag: "wx" });
  await fs.rename(temporary, file);
}

export async function canonicalOutput(directory) {
  const absolute = path.resolve(directory);
  let parent = path.dirname(absolute);
  const missing = [path.basename(absolute)];
  while (true) {
    try {
      const actualParent = await fs.realpath(parent);
      return path.join(actualParent, ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(path.basename(parent));
      const next = path.dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}
