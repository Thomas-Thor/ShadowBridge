"""Private media boundary. Rebuild images and PDFs; never return original bytes.
No outbound calls, links, scripts, fonts from URLs, or file-system paths accepted.
"""
import base64
import hmac
import io
import json
import multiprocessing
import os
import resource
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_INPUT = 8_000_000
MAX_OUTPUT = 12_000_000

def convert(data, kind):
    from PIL import Image, ImageOps
    import pypdfium2 as pdfium
    Image.MAX_IMAGE_PIXELS = 12_000_000
    if kind == "image":
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ("PNG", "JPEG", "WEBP") or image.width * image.height > 12_000_000:
                raise ValueError("Unsupported image")
            image.seek(0)
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((1800, 1800))
            out = io.BytesIO()
            image.save(out, format="PNG", optimize=True)
            image.thumbnail((900, 900))
            preview = io.BytesIO()
            image.save(preview, format="PNG", optimize=True)
            return {"mime": "image/png", "data": out.getvalue(), "previews": [preview.getvalue()]}
    if kind != "pdf" or not data.startswith(b"%PDF-"):
        raise ValueError("Unsupported document")
    document = pdfium.PdfDocument(data)
    if not 1 <= len(document) <= 10:
        raise ValueError("Use an unlocked PDF with 1 to 10 pages")
    rebuilt = []
    previews = []
    pixels = 0
    for page in document:
        width, height = page.get_size()
        if width <= 0 or height <= 0 or width > 1800 or height > 1800:
            raise ValueError("Page dimensions too large")
        bitmap = page.render(scale=1.2, draw_annots=False)
        image = bitmap.to_pil().convert("RGB")
        pixels += image.width * image.height
        if pixels > 25_000_000:
            raise ValueError("Document too large")
        png_file = io.BytesIO()
        image.save(png_file, format="PNG", optimize=True)
        png = png_file.getvalue()
        if sum(map(len, previews)) + len(png) > MAX_OUTPUT:
            raise ValueError("Preview too large")
        previews.append(png)
        rebuilt.append(image)
        bitmap.close()
        page.close()
    safe_file = io.BytesIO()
    rebuilt[0].save(safe_file, format="PDF", save_all=True, append_images=rebuilt[1:], resolution=86.4)
    safe = safe_file.getvalue()
    if len(safe) + sum(map(len, previews)) > MAX_OUTPUT:
        raise ValueError("Document too large")
    document.close()
    for image in rebuilt:
        image.close()
    return {"mime": "application/pdf", "data": safe, "previews": previews}

def child(queue, data, kind):
    try:
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
        result = convert(data, kind)
        queue.put({"mime": result["mime"], "data": base64.b64encode(result["data"]).decode(),
                   "previews": [base64.b64encode(p).decode() for p in result["previews"]], "pages": len(result["previews"])})
    except Exception:
        queue.put({"error": "MEDIA_REJECTED"})

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # No filenames, request bodies, client addresses or credentials.

    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        return self.reply(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

    def do_POST(self):
        key = os.environ.get("MEDIA_SHARED_KEY", "")
        if self.path != "/sanitize" or len(key) < 40 or not hmac.compare_digest(self.headers.get("X-Media-Key", ""), key):
            return self.reply(403, {"error": "FORBIDDEN"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 11_000_000 or self.headers.get("Content-Type") != "application/json":
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if set(payload) != {"data", "kind"}:
                raise ValueError()
            data = base64.b64decode(payload["data"], validate=True)
            if not 1 <= len(data) <= MAX_INPUT:
                raise ValueError()
        except Exception:
            return self.reply(400, {"error": "MEDIA_REJECTED"})
        context = multiprocessing.get_context("spawn")
        queue = context.Queue(1)
        process = context.Process(target=child, args=(queue, data, payload["kind"]))
        process.start()
        try:
            result = queue.get(timeout=20)
            process.join(timeout=1)
            return self.reply(422 if "error" in result else 200, result)
        except Exception:
            return self.reply(422, {"error": "MEDIA_REJECTED"})
        finally:
            if process.is_alive():
                process.kill()
            process.join(timeout=2)
            queue.close()

if __name__ == "__main__":
    HTTPServer((os.environ.get("MEDIA_HOST", "127.0.0.1"), int(os.environ.get("MEDIA_PORT", "8091"))), Handler).serve_forever()
