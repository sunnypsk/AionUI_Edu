#!/usr/bin/env python3
"""Disposable TCP SOCKS5/HTTP servers used only by the Linux image smoke test."""

import http.server
import ipaddress
import json
import select
import socket
import socketserver
import struct
import sys


def receive(connection, length):
    result = b""
    while len(result) < length:
        chunk = connection.recv(length - len(result))
        if not chunk:
            raise ConnectionError("Closed SOCKS socket")
        result += chunk
    return result


class Socks(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            connection = self.request
            connection.settimeout(15)
            version, count = receive(connection, 2)
            if version != 5 or 0 not in receive(connection, count):
                return
            connection.sendall(b"\x05\x00")
            version, command, _, family = receive(connection, 4)
            if version != 5 or command != 1:
                return
            if family == 1:
                host = socket.inet_ntop(socket.AF_INET, receive(connection, 4))
            elif family == 4:
                host = socket.inet_ntop(socket.AF_INET6, receive(connection, 16))
            elif family == 3:
                host = receive(connection, receive(connection, 1)[0]).decode()
            else:
                return
            port = struct.unpack("!H", receive(connection, 2))[0]
            print(json.dumps({"host": host, "port": port}), flush=True)
            with socket.create_connection((host, port), timeout=15) as upstream:
                connection.sendall(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
                while True:
                    ready, _, _ = select.select([connection, upstream], [], [], 20)
                    if not ready:
                        return
                    for source in ready:
                        payload = source.recv(65536)
                        if not payload:
                            return
                        (upstream if source is connection else connection).sendall(payload)
        except (OSError, ConnectionError):
            return


class Http(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        payload = json.dumps({"peer": str(ipaddress.ip_address(self.client_address[0]))}).encode()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        return


if __name__ == "__main__":
    if sys.argv[1:] == ["socks"]:
        class Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True
        Server(("0.0.0.0", 1080), Socks).serve_forever()
    elif sys.argv[1:] == ["http"]:
        http.server.ThreadingHTTPServer(("0.0.0.0", 18080), Http).serve_forever()
    else:
        raise SystemExit("Usage: smokeNetwork.py socks|http")
