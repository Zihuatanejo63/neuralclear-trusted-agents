#!/usr/bin/env python3
"""Minimal MCP (streamable HTTP) client for the Concordium Agent Registry MCP.

Runs on the user's Mac (the assistant VM's egress policy blocks POST /mcp).
Stdlib only. Usage:

  python3 mcp_call.py list
  python3 mcp_call.py call build_agent_card --args cards/final-inputs/buyer-build-agent-card-args.json --out cards/final/buyer-agent-card.raw.json

Prints the raw JSON-RPC response to stdout; with --out, also saves the tool
result's text payload byte-for-byte to the given file and prints its SHA-256.
"""
import argparse
import hashlib
import json
import sys
import urllib.request

MCP_URL = "https://agent-registry-mcp.concordium.com/mcp"
PROTOCOL_VERSION = "2025-03-26"


def post(payload, session_id=None):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(MCP_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json, text/event-stream")
    if session_id:
        req.add_header("Mcp-Session-Id", session_id)
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode()
        sid = resp.headers.get("Mcp-Session-Id")
    # Streamable HTTP may answer with SSE framing; extract the JSON payload.
    if body.lstrip().startswith("event:") or "\ndata:" in body or body.startswith("data:"):
        chunks = []
        for line in body.splitlines():
            if line.startswith("data:"):
                chunks.append(line[5:].strip())
        body = chunks[-1] if chunks else body
    return json.loads(body), sid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["list", "call"])
    ap.add_argument("tool", nargs="?")
    ap.add_argument("--args")
    ap.add_argument("--out")
    ns = ap.parse_args()

    init_resp, sid = post({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "neuralclear-mac-client", "version": "0.1.0"},
        },
    })
    if "error" in init_resp:
        print("initialize failed:", json.dumps(init_resp, indent=2), file=sys.stderr)
        return 1
    try:
        post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    except Exception:
        pass  # notification may return 202 with empty body

    if ns.mode == "list":
        resp, _ = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, sid)
        print(json.dumps(resp, indent=2, ensure_ascii=False))
        return 0

    if not ns.tool or not ns.args:
        print("call mode needs <tool> and --args <file>", file=sys.stderr)
        return 2
    with open(ns.args, "rb") as f:
        arguments = json.loads(f.read().decode())
    resp, _ = post({
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": ns.tool, "arguments": arguments},
    }, sid)
    print(json.dumps(resp, indent=2, ensure_ascii=False))
    if "error" in resp:
        return 1
    if ns.out:
        # Save the first text content block byte-for-byte (the card JSON).
        texts = [
            c.get("text", "")
            for c in resp.get("result", {}).get("content", [])
            if c.get("type") == "text"
        ]
        if texts:
            raw = texts[0].encode()
            with open(ns.out, "wb") as f:
                f.write(raw)
            print("saved:", ns.out, "sha256:", hashlib.sha256(raw).hexdigest(), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
