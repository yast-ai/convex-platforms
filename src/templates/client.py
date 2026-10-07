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
    if base.scheme not in ("http", "https") or not base.netloc or base.username or base.password or base.query or base.fragment:
        raise ValueError("Expected an HTTP site URL without credentials, query, or fragment")
    if not token: raise ValueError("A bearer token is required")
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
