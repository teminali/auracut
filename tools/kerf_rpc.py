"""
Talk to a running Kerf over its local RPC.

The token is read fresh on every call rather than cached: it is
regenerated per launch, and a stale one is the usual cause of "Bad or
missing token".

**Set `KERF_RPC_PORT` to talk to a particular instance.** Kerf used to be
pinned to 3888, which made every one of these suites serial — two of
anything fought over the port, and the loser's config overwrote the
winner's token. Launch each instance with its own `KERF_RPC_PORT` and
point this at the same value, and their suites can run at the same time:

    KERF_RPC_PORT=3901 python3 tools/verify_gpu.py

Each instance writes its own token file, named after the port. The
default port keeps the original filename so nothing already pointing at
`mcp-kerf.json` has to change.
"""
import json
import os
import urllib.request

PORT = int(os.environ.get('KERF_RPC_PORT', '3888'))
_NAME = 'mcp-kerf.json' if PORT == 3888 else f'mcp-kerf-{PORT}.json'
CONFIG = os.path.expanduser(f'~/Library/Application Support/kerf/{_NAME}')
ENDPOINT = f'http://127.0.0.1:{PORT}/rpc'


def token() -> str:
    try:
        servers = json.load(open(CONFIG))['mcpServers']
    except FileNotFoundError:
        raise RuntimeError(
            f'No Kerf token file at {CONFIG}. Is an instance running on port {PORT}? '
            f'Launch one with KERF_RPC_PORT={PORT}, or unset KERF_RPC_PORT for the default.'
        ) from None
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
