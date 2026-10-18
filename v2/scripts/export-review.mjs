import fs from "node:fs/promises";
import path from "node:path";
import { assertPreviewRobots, atomicWrite, repositoryRoot, sha256, sourceFiles, sourceManifest } from "./release-utils.mjs";

if (process.argv.length !== 2) throw new Error("Usage: node scripts/export-review.mjs");
const sources = await sourceFiles();
const output = path.join(repositoryRoot, "review");
const mime = { ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };
function dataURL(name) {
  const file = sources.get(name);
  if (!file) throw new Error(`Unrecognized offline asset: ${name}`);
  const type = mime[path.extname(name)];
  if (!type) throw new Error(`Unrecognized asset MIME type: ${name}`);
  return `data:${type};base64,${file.toString("base64")}`;
}
function inlineStylesheet(name) {
  const source = sources.get(name);
  if (!source || !name.startsWith("assets/") || !name.endsWith(".css")) throw new Error(`Unrecognized stylesheet: ${name}`);
  let css = source.toString("utf8");
  if (/@import\b/i.test(css)) throw new Error("CSS imports must be bundled explicitly.");
  css = css.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g, (original, _quote, url) => {
    if (url.startsWith("#") || url.startsWith("data:")) return original;
    if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("/")) throw new Error(`External CSS asset is not allowed: ${url}`);
    return `url("${dataURL(path.posix.join(path.posix.dirname(name), url))}")`;
  });
  return `<style>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`;
}
let content = sources.get("assets/content.en.js").toString("utf8").replace(/\bexport\s+(?=const\s)/g, "");
let app = sources.get("assets/app.js").toString("utf8");
const importPattern = /^import\s*\{[^}]+\}\s*from\s*["']\.\/content\.en\.js["'];?\s*/;
if (!importPattern.test(app)) throw new Error("Unexpected module structure; update the explicit offline bundling rule.");
app = app.replace(importPattern, "");
if (/^\s*(?:import|export)\s/m.test(app + "\n" + content)) throw new Error("An unbundled module remains.");
const script = `(() => {\n"use strict";\n${content}\n${app}\n})();`.replace(/<\/script/gi, "<\\/script");
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function inlinePage(name) {
  let html = sources.get(name).toString("utf8");
  assertPreviewRobots(html, name);
  html = html.replace(/\s*<!-- release:canonical -->/g, "");
  html = html.replace(/<link\b(?=[^>]*\brel="preload")[^>]*>/gi, "");
  const prefix = name.startsWith("cartel/") ? "../assets/" : "assets/";
  html = html.replace(/<link\b(?=[^>]*\brel="stylesheet")[^>]*>/gi, (tag) => {
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (!href) throw new Error(`Missing stylesheet href in ${name}.`);
    return inlineStylesheet(path.posix.join(path.posix.dirname(name), href));
  });
  html = html.replace(/\b(src|href)="([^"#]+)"/g, (original, attr, url) => {
    if (!url.startsWith(prefix)) return original;
    const normalized = path.posix.normalize(`${name.startsWith("cartel/") ? "cartel/" : ""}${url}`);
    if (normalized === "assets/app.js") return original;
    return `${attr}="${dataURL(normalized)}"`;
  });
  if (name === "index.html") {
    html = html.replace(/<script\b[^>]*\bsrc="assets\/app\.js"[^>]*><\/script>/i, "");
    html = html.replace(/href="(?:\.\/)?cartel\/(?:index\.html)?"/g, 'href="cartel/index.html"');
    html = html.replace("</body>", () => `<script>\n${script}\n</script>\n  </body>`);
  } else {
    html = html.replace(/href="\.\.\/#home"/g, 'href="../ShadowBridge-V2.html#home"');
  }
  if (/(?:src|href)="(?:\.\.\/)?assets\//.test(html)) throw new Error(`An external asset remains in ${name}.`);
  return html.replace(/(<meta charset="utf-8"\s*\/?\s*>)/i, `$1\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`).replace(/[ \t]+$/gm, "");
}

const generated = new Map([
  ["ShadowBridge-V2.html", Buffer.from(inlinePage("index.html"))],
  ["cartel/index.html", Buffer.from(inlinePage("cartel/index.html"))],
  ["robots.txt", Buffer.from("User-agent: *\nDisallow: /\n")],
]);
const licenseNames = [...sources.keys()].filter((name) => /-LICENSE\.txt$/.test(name));
generated.set("FONT-LICENSES.txt", Buffer.from(licenseNames.map((name) => `===== ${name} =====\n\n${sources.get(name).toString("utf8")}`).join("\n\n")));
generated.set("README-PL.md", Buffer.from(`# ShadowBridge V2 — podgląd offline\n\n1. Pobierz ZIP gałęzi feature/shadowbridge-v2 i rozpakuj go na swoim komputerze.\n2. Otwórz review/ShadowBridge-V2.html w Firefox, Chrome lub Edge.\n3. Sprawdź menu, branże, wybór roli, formularz i stronę informacyjną Cartel.\n4. Widok telefonu w Chrome/Edge: F12, Ctrl+Shift+M, szerokość 390 lub 320 px.\n\nOba pliki HTML zawierają fonty, grafiki i style; główna strona zawiera również JavaScript. Strona Cartel nie udostępnia logowania ani paneli. Formularz może otworzyć wiadomość do shadowbridge.trade@gmail.com w Twojej aplikacji pocztowej, pobrać brief lub skopiować jego treść. W aplikacji pocztowej sam sprawdzasz wiadomość i naciskasz Wyślij (Send). Strona sama nie wysyła wiadomości i nie tworzy kont. Jeśli zakodowany adres mailto przekracza 2000 znaków, użyj pobrania briefu lub kopiowania i przygotuj wiadomość ręcznie. Przy otwieraniu z dysku schowek i obsługa mailto zależą od przeglądarki oraz lokalnej aplikacji pocztowej.\n\nZarządzana przeglądarka środowiska Codex blokuje file://; bezpośrednie otwarcie dwuklikiem pozostaje tu niezweryfikowane. Testowany jest podgląd przez lokalny serwer. Jeżeli przeglądarka blokuje pliki lokalne, otwórz terminal w katalogu review i uruchom:\n\n\x60\x60\x60sh\npython3 -m http.server 8000 --bind 127.0.0.1\n\x60\x60\x60\n\nOtwórz http://127.0.0.1:8000/ShadowBridge-V2.html na swoim komputerze. Zatrzymanie serwera: Ctrl+C. Nie publikuje to strony w Internecie. Nie są wymagane npm, klucze API ani backend.\n\nSOURCE-MANIFEST.json zawiera SHA256 źródeł i wygenerowanych plików HTML. Pole baseCommit wskazuje commit bazowy; workingTreeExport informuje o eksporcie z niezacommitowanymi zmianami. Dokładne eksportowane bajty identyfikują hashe źródeł. Eksport należy regenerować po zmianach źródeł poleceniem npm run export:review w v2.\n\nFONT-LICENSES.txt należy zachować przy przekazywaniu eksportu. Eksporter nie usuwa plików PNG; desktop.png i mobile.png należy odświeżyć osobnym testem przeglądarkowym po zmianie wyglądu. Podgląd ma noindex/nofollow i nie wykonuje żądań API.\n`));
const manifest = sourceManifest(sources, "offline-review");
manifest.outputs = Object.fromEntries([...generated].map(([name, buffer]) => [name, sha256(buffer)]));
generated.set("SOURCE-MANIFEST.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));

// Only these generated files are replaced; existing screenshots and unrelated files are preserved.
for (const name of generated.keys()) {
  const file = path.join(output, name);
  let parent = path.dirname(file);
  while (parent !== repositoryRoot) {
    try {
      if ((await fs.lstat(parent)).isSymbolicLink()) throw new Error(`Refusing symlink output directory: ${parent}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    parent = path.dirname(parent);
  }
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error(`Refusing symlink output file: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const [name, buffer] of generated) await atomicWrite(path.join(output, name), buffer);
console.log(`Prepared offline review: ${path.join(output, "ShadowBridge-V2.html")}\nIncluded Cartel information page; existing PNG files were preserved.\nNo deployment, external service, Git push or registration was performed.`);
