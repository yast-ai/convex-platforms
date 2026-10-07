import json
from urllib.error import HTTPError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

class ApiError(Exception):
    def __init__(self, status: int, data: object):
        super().__init__(f"Request failed ({status})")
        self.status, self.data = status, data

class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def _request(site_url: str, token: str, path: str, args: object):
    base = urlsplit(site_url)
    if not base.netloc or base.username or base.password or base.query or base.fragment or base.path not in ("", "/") or (base.scheme != "https" and not (base.scheme == "http" and base.hostname in ("localhost", "127.0.0.1", "::1"))):
        raise ValueError("Expected an HTTPS site origin; HTTP is allowed only on localhost")
    if not token or "\r" in token or "\n" in token: raise ValueError("A bearer token is required")
    request = Request(urlunsplit((base.scheme, base.netloc, path, "", "")), data=json.dumps(args).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    try:
        with build_opener(_NoRedirect()).open(request, timeout=30) as response:
            raw = response.read().decode()
            try: value = json.loads(raw)
            except ValueError: raise ApiError(response.status, raw) from None
            if not isinstance(value, dict) or value.get("status") != "success" or "value" not in value: raise ApiError(response.status, value)
            return value["value"]
    except HTTPError as error:
        raw = error.read().decode()
        try: raw = json.loads(raw)
        except ValueError: pass
        raise ApiError(error.code, raw) from None
