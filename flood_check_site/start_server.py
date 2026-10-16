"""Serve Kustöversvämnings Kollen locally and open it in your browser.

Usage:  python start_server.py        (then visit http://localhost:8000)
The flood data is stored in a few large "pack" files that the page reads piece by
piece with HTTP Range requests, so this server supports Range.
"""
import http.server, socketserver, webbrowser, os, re, threading

PORT = int(os.environ.get('PORT', 8000))
ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.bin': 'application/octet-stream', '.js': 'text/javascript', '.json': 'application/json'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def do_GET(self):
        m = re.match(r'bytes=(\d+)-(\d+)$', self.headers.get('Range', ''))
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return super().do_GET()
        start, end = int(m.group(1)), int(m.group(2))
        size = os.path.getsize(path)
        end = min(end, size - 1)
        with open(path, 'rb') as f:
            f.seek(start); data = f.read(end - start + 1)
        self.send_response(206)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        self.wfile.write(data)

socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}/'
    print(f'Kustöversvämnings Kollen körs på {url}  (tryck Ctrl+C för att stänga)')
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
