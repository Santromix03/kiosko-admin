# Servidor de desarrollo sin caché (usar en lugar de "python -m http.server")
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


print("Servidor en http://localhost:5500  (Ctrl+C para detener)")
ThreadingHTTPServer(("", 5500), NoCacheHandler).serve_forever()