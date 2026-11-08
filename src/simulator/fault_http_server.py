#!/usr/bin/env python3
"""
fault_http_server.py — SafeDash Fault Injection HTTP Bridge
============================================================
Serves as a lightweight HTTP server that:
  1. Accepts POST /fault requests from the browser UI fault panel.
  2. Forwards them as UDP datagrams to the QNX resmgr fault receiver (port 9200).
  3. Also serves the UI static files so you can open the dashboard without
     dealing with CORS/file:// restrictions.

Usage:
  python fault_http_server.py
  python fault_http_server.py --http-port 9201 --fault-port 9200 --ui-dir ../ui

Then open: http://localhost:9201/
"""

import argparse
import json
import os
import socket
import sys
import mimetypes
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration defaults
# ---------------------------------------------------------------------------
DEFAULT_HTTP_PORT  = 9201
DEFAULT_FAULT_PORT = 9200
DEFAULT_FAULT_HOST = "127.0.0.1"
DEFAULT_UI_DIR     = Path(__file__).parent.parent.parent / "ui"

_fault_host: str = DEFAULT_FAULT_HOST
_fault_port: int = DEFAULT_FAULT_PORT
_ui_dir:     Path = DEFAULT_UI_DIR

# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------
class SafeDashHTTPHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):  # quieter logging
        if args and str(args[1]) not in ("200", "304"):
            super().log_message(format, *args)

    # -- CORS pre-flight --
    def do_OPTIONS(self):
        self._send_cors_headers(200)
        self.end_headers()

    # -- POST /fault  (fault injection from UI) --
    def do_POST(self):
        if self.path == "/fault":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)

            try:
                cmd = json.loads(body)
                fault = cmd.get("fault", "unknown")
                param = cmd.get("param", 0)

                # Forward to resmgr via UDP
                udp_payload = json.dumps({"fault": fault, "param": param}).encode()
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.sendto(udp_payload, (_fault_host, _fault_port))

                print(f"[HTTP->UDP] Fault '{fault}' forwarded to {_fault_host}:{_fault_port}")
                self._json_response(200, {"status": "ok", "fault": fault})

            except (json.JSONDecodeError, OSError) as e:
                self._json_response(400, {"status": "error", "detail": str(e)})
        else:
            self._json_response(404, {"status": "not found"})

    # -- GET / (serve static UI files) --
    def do_GET(self):
        # Map / -> index.html
        path = self.path.split("?")[0]
        if path == "/":
            path = "/index.html"

        file_path = _ui_dir / path.lstrip("/")

        if not file_path.exists() or not file_path.is_file():
            self._json_response(404, {"status": "not found", "path": path})
            return

        # Serve the file
        mime, _ = mimetypes.guess_type(str(file_path))
        mime = mime or "application/octet-stream"

        data = file_path.read_bytes()
        self._send_cors_headers(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # -- Helpers --
    def _send_cors_headers(self, code: int):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json_response(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self._send_cors_headers(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    global _fault_host, _fault_port, _ui_dir

    parser = argparse.ArgumentParser(description="SafeDash Fault HTTP Bridge")
    parser.add_argument("--http-port",  type=int, default=DEFAULT_HTTP_PORT)
    parser.add_argument("--fault-host", default=DEFAULT_FAULT_HOST)
    parser.add_argument("--fault-port", type=int, default=DEFAULT_FAULT_PORT)
    parser.add_argument("--ui-dir",     default=str(DEFAULT_UI_DIR))
    args = parser.parse_args()

    _fault_host = args.fault_host
    _fault_port = args.fault_port
    _ui_dir     = Path(args.ui_dir).resolve()

    if not _ui_dir.exists():
        print(f"[ERROR] UI directory not found: {_ui_dir}", file=sys.stderr)
        sys.exit(1)

    server = HTTPServer(("0.0.0.0", args.http_port), SafeDashHTTPHandler)
    print(f"SafeDash HTTP Bridge running:")
    print(f"  Dashboard: http://localhost:{args.http_port}/")
    print(f"  Fault API:  POST http://localhost:{args.http_port}/fault")
    print(f"  UI dir:    {_ui_dir}")
    print(f"  Resmgr:    UDP {_fault_host}:{_fault_port}")
    print(f"\nPress Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[HTTP] Stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
