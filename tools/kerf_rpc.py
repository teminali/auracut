"""
Talk to a running Kerf over its local RPC.

The token is rewritten by whichever instance currently holds port 3888,
so it is read fresh on every call rather than cached — a stale one is the
usual cause of "Bad or missing token", and only one Kerf can hold the
port, so a dev build and an installed one will fight over it.
"""
import json
import os
import urllib.request

CONFIG = os.path.expanduser('~/Library/Application Support/kerf/mcp-kerf.json')
ENDPOINT = 'http://127.0.0.1:3888/rpc'


def token() -> str:
    servers = json.load(open(CONFIG))['mcpServers']
    return servers[next(iter(servers))]['env']['KERF_RPC_TOKEN']


def call(name: str, args: dict | None = None, timeout: int = 900) -> dict:
    body = json.dumps({'method': 'tools/call',
                       'params': {'name': name, 'arguments': args or {}}}).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={'x-kerf-token': token(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def ok(result: dict, what: str) -> dict:
    """Unwrap a tool result, raising with the real error rather than a KeyError."""
    payload = result.get('result', {})
    if not payload.get('success'):
        raise RuntimeError(f'{what}: {json.dumps(result)[:400]}')
    return payload['data']
