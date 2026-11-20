#!/usr/bin/env python3
"""Sign (and optionally send) Kalshi API v2 requests — the portfolio half the static site cannot do.

Why this exists
---------------
Every `/portfolio/*` read and every order write requires an `Ed25519` or `RSA`
signature over `timestamp + METHOD + path`, and browsers cannot do that safely:
they cannot set custom WebSocket handshake headers and must never hold a private
key (see docs.kalshi.com/getting_started/api_keys and websockets/websocket-connection).
Run this on your own machine or behind a proxy; the Pages site stays static.

Key custody — the whole rule
----------------------------
The private key is read from the environment and never written anywhere:
    KALSHI_API_KEY_ID            api key id from demo.kalshi.co -> Account -> API keys
    KALSHI_API_PRIVATE_KEY_PEM   PEM body, or a raw/base64/hex 32-byte Ed25519 seed
Nothing here prints the key, and `--self-test` needs no key at all.

Examples
--------
    # 1. check the crypto without touching the network
    python3 tools/kalshi_sign.py --self-test

    # 2. print the exact curl command for a balance read (key stays in the env)
    python3 tools/kalshi_sign.py --method GET --path /trade-api/v2/portfolio/balance --curl

    # 3. actually send it against the demo host
    python3 tools/kalshi_sign.py --base https://external-api.demo.kalshi.co \\
        --method GET --path /trade-api/v2/portfolio/balance --send

    # 4. a resting 1-contract bid, the payload documented in quick_start_create_order
    python3 tools/kalshi_sign.py --method POST \\
        --path /trade-api/v2/portfolio/events/orders \\
        --body '{"ticker":"KXBTC15M-26NOV200615-15","side":"bid","count":"1","price":"0.0100","time_in_force":"good_till_canceled","self_trade_prevention_type":"taker_at_cross","client_order_id":"strat:test|topic:crypto|role:taker"}' \\
        --send

This tool refuses to run `--send` unless `KALSHI_ALLOW_LIVE=1` is also set, so an
order cannot be placed by copy-pasting a command from a document.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HEADER_TS = "KALSHI-ACCESS-TIMESTAMP"
HEADER_KEY = "KALSHI-ACCESS-KEY"
HEADER_SIG = "KALSHI-ACCESS-SIGNATURE"
TOLERANCE_S = 30          # server rejects timestamps more than ~30s off


# --------------------------------------------------------------------------- #
# Pure-python Ed25519 (RFC 8032 section 6 reference implementation).
# Used only when the `cryptography` package is unavailable; verified against
# the RFC test vectors by --self-test, so it is either correct or loudly broken.
# --------------------------------------------------------------------------- #
_Q = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _Q - 2, _Q) % _Q
_I = pow(2, (_Q - 1) // 4, _Q)


def _recover_x(y: int):
    xx = (y * y - 1) * pow(_D * y * y + 1, _Q - 2, _Q) % _Q
    x = pow(xx, (_Q + 3) // 8, _Q)
    if (x * x - xx) % _Q != 0:
        x = x * _I % _Q
    if x % 2 != 0:
        x = _Q - x
    return x % _Q


_BY = 4 * pow(5, _Q - 2, _Q) % _Q
_B = (_recover_x(_BY), _BY)


def _add(P, Qp):
    x1, y1 = P
    x2, y2 = Qp
    x3 = (x1 * y2 + x2 * y1) * pow(1 + _D * x1 * x2 * y1 * y2, _Q - 2, _Q) % _Q
    y3 = (y1 * y2 + x1 * x2) * pow(1 - _D * x1 * x2 * y1 * y2, _Q - 2, _Q) % _Q
    return (x3, y3)


def _mul(P, e: int):
    if e == 0:
        return (0, 1)
    Qp = _mul(P, e // 2)
    Qp = _add(Qp, Qp)
    if e & 1:
        Qp = _add(Qp, P)
    return Qp


def _encode_point(P) -> bytes:
    x, y = P
    bits = bytearray(y.to_bytes(32, "little"))
    bits[31] |= (x & 1) << 7
    return bytes(bits)


def _decode_point(s: bytes):
    y = int.from_bytes(s, "little") & (1 << 255) - 1
    x = _recover_x(y)
    if (x & 1) != (int.from_bytes(s, "little") >> 255) & 1:
        x = _Q - x
    return (x, y)


def _hint(*parts: bytes) -> int:
    return int.from_bytes(hashlib.sha512(b"".join(parts)).digest(), "little")


def _secret_expand(seed: bytes):
    """RFC 8032 key clamping: h = SHA-512(seed); a = h[0:32] with the low three
    bits cleared, bit 255 cleared and bit 254 set."""
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= ~7                      # clear bits 0-2
    a &= ~(1 << 255)             # clear bit 255
    a |= 1 << 254                # set bit 254
    return a, h[32:64]


def _ed25519_sign(seed: bytes, msg: bytes) -> bytes:
    a, prefix = _secret_expand(seed)
    pub = _encode_point(_mul(_B, a))
    r = _hint(prefix, msg) % _L
    big_r = _encode_point(_mul(_B, r))
    k = _hint(big_r, pub, msg) % _L
    s = (r + k * a) % _L
    return big_r + s.to_bytes(32, "little")


def _ed25519_verify(sig: bytes, msg: bytes, pub: bytes) -> bool:
    """Standard check: [S]B == R + [k]A, with k = H(R \| A \| msg)."""
    try:
        if len(sig) != 64:
            return False
        s_int = int.from_bytes(sig[32:], "little")
        if s_int >= _L:
            return False
        R = _decode_point(sig[:32])
        A = _decode_point(pub)
        k = _hint(sig[:32], pub, msg) % _L
        left = _mul(_B, s_int)
        right = _add(R, _mul(A, k))
        return _encode_point(left) == _encode_point(right)
    except Exception:  # a malformed point is simply an invalid signature
        return False


# --------------------------------------------------------------------------- #
# key loading
# --------------------------------------------------------------------------- #
def load_private_key():
    """Return ("ed25519", seed_bytes) or ("rsa", pem_str). Raises with instructions."""
    raw = os.environ.get("KALSHI_API_PRIVATE_KEY_PEM", "").strip()
    if not raw:
        raise SystemExit(
            "no key in the environment. Set KALSHI_API_PRIVATE_KEY_PEM to the PEM (or the\n"
            "base64/hex 32-byte Ed25519 seed) shown once when the key was created on\n"
            "demo.kalshi.co -> Account settings -> API keys. Nothing is read from a file\n"
            "in this repo, by design: see questions.html#q-2 for the custody decision."
        )
    if "-----BEGIN" in raw:
        try:
            from cryptography.hazmat.primitives.serialization import load_pem_private_key  # type: ignore
        except ImportError:
            raise SystemExit(
                "a PEM key needs the `cryptography` package (pip install cryptography).\n"
                "For Ed25519 you can instead put the raw 32-byte seed (hex or base64) in the\n"
                "same variable and this tool will sign with its built-in implementation."
            )
        key = load_pem_private_key(raw.encode(), password=None)
        name = type(key).__name__
        if "Ed25519" in name:
            return "ed25519-pem", key
        if "RSA" in name:
            return "rsa-pem", key
        raise SystemExit(f"unsupported key type {name}; Kalshi accepts Ed25519 or RSA keys")

    # raw seed, hex or base64
    for decoder, label in ((bytes.fromhex, "hex"), (base64.b64decode, "base64")):
        try:
            blob = decoder(raw.replace("\\n", "").replace("\n", ""))
        except (ValueError, binascii.Error):
            continue
        if len(blob) >= 32:
            return "ed25519", blob[:32]
        print(f"  ! {label} decode gave {len(blob)} bytes, need 32", file=sys.stderr)
    raise SystemExit("could not parse KALSHI_API_PRIVATE_KEY_PEM as PEM, hex, or base64.")


def sign_payload(kind: str, key, payload: str) -> str:
    """Ed25519 only; RSA is signed in build_signature() because it needs the hash object."""
    data = payload.encode()
    if kind == "ed25519":
        return base64.b64encode(_ed25519_sign(key, data)).decode()
    if kind == "ed25519-pem":
        return base64.b64encode(key.sign(data)).decode()
    raise SystemExit("unknown signing kind: " + kind)


def build_signature(method: str, path_with_query: str, ts_ms: int, kind: str, key) -> dict:
    """String to sign = timestamp + METHOD + path, query string EXCLUDED.

    The path must keep the API root prefix (e.g. /trade-api/v2/portfolio/balance)
    exactly as it appears in the URL, because that is what the server hashes.
    """
    path = path_with_query.split("?", 1)[0]
    payload = f"{ts_ms}{method.upper()}{path}"
    if kind == "rsa-pem":
        from cryptography.hazmat.primitives import hashes  # type: ignore
        from cryptography.hazmat.primitives.asymmetric import padding, utils  # type: ignore
        sig = key.sign(payload.encode(),
                      padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=hashes.SHA256().digest_size),
                      utils.Prehashed(hashes.SHA256()) if hasattr(utils, "Prehashed") else hashes.SHA256())
        b64 = base64.b64encode(sig).decode()
    else:
        b64 = sign_payload(kind, key, payload)
    return {"payload": payload, "signature": b64, "timestamp": str(ts_ms)}


def self_test() -> int:
    """Verify the built-in Ed25519 against RFC 8032 vectors, then the signing
    contract Kalshi uses (timestamp + METHOD + path, query excluded).

    The expected values below are copied from RFC 8032 section 7.1 TEST 1 and
    TEST 2 — if this passes, the signature bytes are standard Ed25519 and can be
    checked by any other implementation, including Kalshi's verifier.
    """
    rc = 0

    def ck(label, ok, extra=""):
        nonlocal rc
        print(("  ok  " if ok else "  FAIL ") + label + ((" — " + extra) if (extra and not ok) else ""))
        if not ok:
            rc = 1

    seed1 = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    pub1 = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    sig1 = ("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
    a1, _ = _secret_expand(seed1)
    ck("derives the RFC 8032 TEST 1 public key", _encode_point(_mul(_B, a1)).hex() == pub1)
    got1 = _ed25519_sign(seed1, b"").hex()
    ck("signs RFC 8032 TEST 1 (empty message) byte-for-byte", got1 == sig1, got1)

    seed2 = bytes.fromhex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb")
    sig2 = ("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
            "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")
    got2 = _ed25519_sign(seed2, bytes.fromhex("72")).hex()
    ck("signs RFC 8032 TEST 2 (one-byte message) byte-for-byte", got2 == sig2, got2)

    pub_bytes = bytes.fromhex(pub1)
    ck("verify() accepts a valid signature", _ed25519_verify(bytes.fromhex(sig1), b"", pub_bytes))
    tampered = bytes.fromhex(sig1[:-2] + ("01" if not sig1.endswith("01") else "02"))
    ck("verify() rejects a tampered signature", not _ed25519_verify(tampered, b"", pub_bytes))

    probe = build_signature("GET", "/trade-api/v2/portfolio/balance?foo=1", 1700000000000, "ed25519", seed1)
    want = "1700000000000GET/trade-api/v2/portfolio/balance"
    ck("query string excluded from the signed payload", probe["payload"] == want, probe["payload"])
    ck("timestamp is the first element of the payload", probe["payload"].startswith("1700000000000"))

    print("self-test", "PASSED — standard Ed25519, safe to use for signing" if rc == 0
          else "FAILED — do not use this tool; fall back to the `cryptography` package")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="https://external-api.demo.kalshi.co")
    ap.add_argument("--method", default="GET")
    ap.add_argument("--path", default="/trade-api/v2/portfolio/balance")
    ap.add_argument("--body", default="", help="JSON string, sent verbatim and byte-identical")
    ap.add_argument("--curl", action="store_true", help="print a copy-pasteable curl command")
    ap.add_argument("--send", action="store_true", help="actually perform the request")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        return self_test()

    kind, key = load_private_key()
    key_id = os.environ.get("KALSHI_API_KEY_ID", "")
    if not key_id:
        raise SystemExit("KALSHI_API_KEY_ID is not set")
    ts = int(time.time() * 1000)
    signed = build_signature(a.method, a.path, ts, kind, key)
    skew = abs(int(time.time()) - ts // 1000)
    if skew > TOLERANCE_S:
        print(f"  ! local clock is {skew}s off the value being signed; the server allows ±{TOLERANCE_S}s", file=sys.stderr)
    url = a.base.rstrip("/") + a.path
    headers = {HEADER_TS: signed["timestamp"], HEADER_KEY: key_id, HEADER_SIG: signed["signature"],
               "Content-Type": "application/json"}

    print(json.dumps({"signing_payload": signed["payload"], "signed_with": kind,
                      "signature_b64_len": len(signed["signature"]), "url": url,
                      "note": "the signature is not printed; the timestamp must reach the server within "
                              f"{TOLERANCE_S}s of signing"}, indent=1))

    if a.curl:
        hdrs = " ".join(f"-H '{k}: {v}'" for k, v in headers.items())
        body = f" --data '{a.body}'" if a.body else ""
        print(f"\ncurl -sS -X {a.method.upper()} {hdrs}{body} '{url}'")
        print("  (the signature above is already stale in seconds — regenerate with --curl just before pasting)")
        return 0

    if not a.send:
        print("nothing sent; pass --send to perform the request")
        return 0
    if os.environ.get("KALSHI_ALLOW_LIVE") != "1":
        raise SystemExit("refusing to send: set KALSHI_ALLOW_LIVE=1 to confirm you mean a live call\n"
                         "against the host in --base (writes place real orders on that account).")

    req = urllib.request.Request(url, data=a.body.encode() if a.body else None,
                                 headers=headers, method=a.method.upper())
    try:
        with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context()) as resp:
            print(resp.status, resp.read().decode()[:4000])
            return 0
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code}: {exc.read().decode()[:1200]}", file=sys.stderr)
        print("compare against docs.kalshi.com/getting_started/order_errors for the code's meaning.", file=sys.stderr)
        return 2
    except (urllib.error.URLError, OSError) as exc:
        print(f"transport failure: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
