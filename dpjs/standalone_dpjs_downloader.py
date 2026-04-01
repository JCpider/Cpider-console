import base64
import contextlib
import inspect
import json
import os.path
import time
import urllib.parse
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any, Callable, Generator, Mapping

from DrissionPage import Chromium
from DrissionPage._configs.chromium_options import ChromiumOptions
from DrissionPage._pages.mix_tab import MixTab
from DrissionPage.errors import JavaScriptError


class CaseInsensitiveHeaders(dict):
    def __init__(self, data: Mapping[str, Any] | None = None, **kwargs: Any):
        super().__init__()
        if data:
            self.update(data)
        if kwargs:
            self.update(kwargs)

    @staticmethod
    def _variants(key: Any) -> tuple[str, str, str]:
        text = str(key)
        return text.lower(), text.upper(), text.title()

    def _existing_key(self, key: Any) -> str | None:
        for variant in self._variants(key):
            if dict.__contains__(self, variant):
                return variant
        return None

    def __setitem__(self, key: Any, value: Any) -> None:
        real_key = self._existing_key(key) or str(key)
        dict.__setitem__(self, real_key, value)

    def __getitem__(self, key: Any) -> Any:
        real_key = self._existing_key(key)
        if real_key is None:
            raise KeyError(key)
        return dict.__getitem__(self, real_key)

    def __contains__(self, key: object) -> bool:
        return self._existing_key(key) is not None

    def get(self, key: Any, default: Any = None) -> Any:
        real_key = self._existing_key(key)
        if real_key is None:
            return default
        return dict.__getitem__(self, real_key)

    def pop(self, key: Any, default: Any = None) -> Any:
        real_key = self._existing_key(key)
        if real_key is None:
            return default
        return dict.pop(self, real_key)

    def update(self, other: Mapping[str, Any] | None = None, **kwargs: Any) -> None:
        if other:
            for key, value in other.items():
                self[key] = value
        for key, value in kwargs.items():
            self[key] = value


@dataclass
class StandaloneRequest:
    url: str
    method: str = "GET"
    params: Mapping[str, Any] | None = None
    data: Any = None
    json: Any = None
    headers: Mapping[str, Any] | None = None
    cookies: Mapping[str, Any] | str | None = None
    timeout: int | float | None = None
    allow_redirects: bool = True
    proxies: dict[str, str] | None = None
    extra: dict[str, Any] | None = None
    body: Any = None

    def __post_init__(self) -> None:
        self.method = self.method.upper()
        self.params = dict(self.params or {})
        self.headers = CaseInsensitiveHeaders(self.headers or {})
        self.proxies = dict(self.proxies or {}) if self.proxies else None
        self.extra = dict(self.extra or {})

    @property
    def real_url(self) -> str:
        if not self.params:
            return self.url
        scheme, netloc, path, params, query, fragment = urllib.parse.urlparse(self.url)
        query = "&".join([query, urllib.parse.urlencode(self.params)]) if query else urllib.parse.urlencode(self.params)
        return urllib.parse.urlunparse([scheme, netloc, path, params, query, fragment])


@dataclass
class StandaloneResponse:
    content: bytes = b""
    status_code: int = 0
    headers: CaseInsensitiveHeaders = field(default_factory=CaseInsensitiveHeaders)
    url: str | None = None
    reason: str = "empty"
    request: StandaloneRequest | None = None
    history: list["StandaloneResponse"] = field(default_factory=list)
    error: str | None = None
    rt: float = 0.0
    _text_cache: str | None = field(default=None, init=False, repr=False)

    @classmethod
    def make_response(cls, **kwargs: Any) -> "StandaloneResponse":
        kwargs.setdefault("status_code", 0)
        kwargs.setdefault("reason", "empty")
        headers = kwargs.get("headers")
        kwargs["headers"] = headers if isinstance(headers, CaseInsensitiveHeaders) else CaseInsensitiveHeaders(headers or {})
        return cls(**kwargs)

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 400

    @property
    def text(self) -> str:
        if self._text_cache is None:
            self._text_cache = self.content.decode("utf-8", errors="replace") if isinstance(self.content, bytes) else str(self.content)
        return self._text_cache

    def json(self) -> Any:
        return json.loads(self.text)


class StandaloneDpJsDownloader:
    def __init__(
        self,
        user_data_path: str,
        *,
        host: str = "",
        headless: bool = True,
        reusable: bool = True,
        incognito: bool = False,
        proxy_extension: str | None = None,
        browser_path: str | None = None,
        server: str | int | None = None,
        extra_chromium_args: Mapping[str, Any] | None = None,
        default_timeout: int | float = 30,
        max_redirects: int = 10,
    ) -> None:
        self._browser: Chromium | None = None
        self._local_path = user_data_path
        self.host = host
        self.headless = headless
        self.reusable = reusable
        self.incognito = incognito
        self.proxy_extension = proxy_extension
        self.browser_path = browser_path
        self.server = server
        self.extra_chromium_args = dict(extra_chromium_args or {})
        self.default_timeout = default_timeout
        self.max_redirects = max_redirects
        self.options = ChromiumOptions()
        self.tab: MixTab | None = None
        self._now_proxy = ""
        self._base_options = {"--disable-web-security": ""}
        self._validate_proxy_extension()
        self.set_options()

    @staticmethod
    def _normalize_proxy(proxy: str | None) -> str | None:
        if not proxy:
            return None
        parsed = urllib.parse.urlparse(proxy if "://" in proxy else f"http://{proxy}")
        if parsed.username:
            raise ValueError(f"Direct Chromium proxy does not support auth proxy: {proxy}")
        return f"http://{parsed.netloc}"

    @staticmethod
    def _origin(url: str | None) -> str:
        if not url:
            return ""
        parsed = urllib.parse.urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return ""
        return f"{parsed.scheme}://{parsed.netloc}"

    @staticmethod
    def _status_reason(status_code: int) -> str:
        with contextlib.suppress(ValueError):
            return HTTPStatus(status_code).phrase
        return "unknown"

    def _validate_proxy_extension(self) -> None:
        if not self.proxy_extension:
            return
        if not os.path.isdir(self.proxy_extension):
            raise FileNotFoundError(f"proxy_extension directory not found: {self.proxy_extension}")
        extension_entry = os.path.join(self.proxy_extension, "newtab.html")
        if not os.path.exists(extension_entry):
            raise FileNotFoundError(f"proxy_extension newtab.html not found: {extension_entry}")

    def set_options(self, options: Mapping[str, Any] | None = None, proxy_server: str | None = None) -> ChromiumOptions:
        self.options = ChromiumOptions()
        merged = {**self._base_options, **self.extra_chromium_args, **dict(options or {})}
        if proxy_server:
            merged["--proxy-server"] = proxy_server
        for key, value in merged.items():
            self.options.set_argument(key, value if value not in (None, "") else None)
        if self.proxy_extension:
            self.options.add_extension(self.proxy_extension)
        if self.browser_path:
            self.options.set_browser_path(self.browser_path)
        if self._local_path:
            self.options.set_user_data_path(self._local_path)
        if self.server is not None:
            if isinstance(self.server, int) or (isinstance(self.server, str) and self.server.isdigit()):
                self.options.set_local_port(int(self.server))
            elif isinstance(self.server, str):
                self.options.set_address(self.server)
            else:
                raise ValueError("server must be int or str")
        else:
            self.options.auto_port()
        self.options.headless(self.headless)
        self.options.incognito(self.incognito)
        return self.options

    def xvfb(self) -> "StandaloneDpJsDownloader":
        return self

    def close(self, clear_cache: bool = True) -> None:
        self.clear_browser(clear_cache=clear_cache)

    def clear_browser(self, clear_cache: bool = True) -> None:
        if self._browser:
            try:
                self._browser.quit(force=True, del_data=clear_cache)
            finally:
                self._browser = None
                self._now_proxy = ""
                self.tab = None

    @contextlib.contextmanager
    def browser(self, proxy_server: str | None = None) -> Generator[Chromium, Any, None]:
        normalized_proxy = proxy_server or ""
        if normalized_proxy != self._now_proxy and not self.proxy_extension and self._browser:
            self.clear_browser(clear_cache=False)
        if not self.reusable or not self._browser:
            self.set_options(proxy_server=proxy_server)
            self._browser = Chromium(self.options)
            self._now_proxy = normalized_proxy
        try:
            yield self._browser
        finally:
            if not self.reusable:
                self.clear_browser()

    def set_proxy(self, tab: MixTab, proxy: str | None = None) -> None:
        if not proxy or self._now_proxy == proxy:
            return
        if not self.proxy_extension:
            raise ValueError("proxy_extension is required for dynamic proxy switching")
        if tab.url.startswith("chrome"):
            path = os.path.join(self.proxy_extension, "newtab.html")
            tab.get(f"file:///{path}")
        script = f"window.proxyAPI.setConfig({json.dumps(proxy)})"
        tab.run_async_js(script)
        self._now_proxy = proxy

    @staticmethod
    def _invoke_callback(func: Callable | None, **context: Any) -> Any:
        if not callable(func):
            return None
        parameters = inspect.signature(func).parameters
        kwargs = {name: value for name, value in context.items() if name in parameters}
        positional = []
        if "tab" in parameters and "tab" in context:
            positional.append(context["tab"])
            kwargs.pop("tab", None)
        return func(*positional, **kwargs)

    @staticmethod
    def _normalize_cookies(cookies: Mapping[str, Any] | str | None) -> str | None:
        if not cookies:
            return None
        if isinstance(cookies, str):
            return cookies
        return "; ".join(f"{key}={value}" for key, value in cookies.items())

    @staticmethod
    def _resolve_proxy(request: StandaloneRequest) -> str | None:
        proxies = request.proxies or {}
        return proxies.get("http") or proxies.get("https")

    @staticmethod
    def _serialize_body(request: StandaloneRequest, headers: CaseInsensitiveHeaders) -> str | None:
        if request.body is not None:
            if isinstance(request.body, bytes):
                return request.body.decode("utf-8", errors="replace")
            return str(request.body)
        if request.json is not None:
            if headers.get("content-type") is None:
                headers["Content-Type"] = "application/json"
            return json.dumps(request.json, ensure_ascii=False)
        if request.data is None:
            return None
        if isinstance(request.data, Mapping):
            if headers.get("content-type") is None:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            return urllib.parse.urlencode(request.data, doseq=True)
        if isinstance(request.data, bytes):
            return request.data.decode("utf-8", errors="replace")
        return str(request.data)

    def _make_request(self, request: StandaloneRequest | Mapping[str, Any]) -> StandaloneRequest:
        if isinstance(request, StandaloneRequest):
            return request
        return StandaloneRequest(**dict(request))

    def _bootstrap_tab(self, tab: MixTab, host: str, cookies: str | None) -> None:
        bootstrap_url = host or "https://baidu.com"
        if self._origin(bootstrap_url) != self._origin(tab.url):
            tab.get(bootstrap_url)
        if host and cookies:
            tab.set.cookies(cookies=cookies)

    def real_fetch_by_js(self, request: StandaloneRequest, next_url: str | None = None) -> dict[str, Any]:
        url = next_url or request.real_url
        headers = CaseInsensitiveHeaders(request.headers)
        headers["user-agent"] = None
        body = self._serialize_body(request, headers)
        timeout = request.timeout or self.default_timeout
        js_options: dict[str, Any] = {
            "headers": {key: value for key, value in headers.items() if value is not None},
            "cache": "no-cache",
            "redirect": "manual",
            "method": request.method,
        }
        if body is not None:
            js_options["body"] = body

        script = """
        return (async () => {
            const url = arguments[0];
            const options = arguments[1];
            const timeoutMs = arguments[2];
            const controller = new AbortController();
            const timer = timeoutMs ? setTimeout(() => controller.abort(`timeout:${timeoutMs}`), timeoutMs) : null;
            try {
                const response = await fetch(url, {...options, signal: controller.signal});
                const buffer = await response.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64String = btoa(binary);
                const headers = {};
                response.headers.forEach((value, key) => {
                    headers[key] = value;
                });
                return {
                    success: true,
                    content: base64String,
                    headers,
                    status_code: response.status,
                    url: response.url,
                };
            } catch (error) {
                return {success: false, error: error && error.message ? error.message : String(error)};
            } finally {
                if (timer) clearTimeout(timer);
            }
        })();
        """

        host = request.extra.get("host") or request.headers.get("host") or self.host
        cookies = request.extra.get("cookies") or request.cookies or request.headers.get("cookies") or request.headers.get("cookie")
        on_load = request.extra.get("on_load")
        proxy_value = self._resolve_proxy(request)
        proxy_server = None if self.proxy_extension else self._normalize_proxy(proxy_value)

        try:
            with self.browser(proxy_server=proxy_server) as browser:
                tab = browser.latest_tab
                self.tab = tab
                if self.proxy_extension and proxy_value:
                    self.set_proxy(tab, proxy_value)
                normalized_cookies = self._normalize_cookies(cookies)
                self._bootstrap_tab(tab, host, normalized_cookies)
                self._invoke_callback(on_load, tab=tab, browser=browser, request=request)
                return tab.run_js(script, url, js_options, int(timeout * 1000) if timeout else 0)
        except JavaScriptError:
            self.clear_browser(clear_cache=False)
            raise

    def fetch(self, request: StandaloneRequest | Mapping[str, Any]) -> StandaloneResponse:
        prepared = self._make_request(request)
        response = StandaloneResponse.make_response(request=prepared)
        next_url = prepared.real_url
        start = time.perf_counter()

        try:
            for redirect_count in range(self.max_redirects + 1):
                js_response = self.real_fetch_by_js(prepared, next_url)
                if error := js_response.get("error"):
                    response.error = error
                    raise RuntimeError(error)
                content = base64.b64decode(js_response["content"].encode())
                headers = CaseInsensitiveHeaders(js_response.get("headers") or {})
                status_code = int(js_response["status_code"])
                url = js_response["url"]
                location = headers.get("location") or headers.get("Location")

                if prepared.allow_redirects and location:
                    if redirect_count >= self.max_redirects:
                        raise RuntimeError(f"Too many redirects: {self.max_redirects}")
                    redirect_url = urllib.parse.urljoin(url, location)
                    response.history.append(
                        StandaloneResponse(
                            content=content,
                            headers=headers,
                            url=url,
                            status_code=status_code,
                            reason=self._status_reason(status_code),
                            request=StandaloneRequest(
                                url=prepared.real_url,
                                method=prepared.method,
                                headers=dict(prepared.headers),
                            ),
                        )
                    )
                    if prepared.extra.get("auto_referer", True):
                        prepared.headers["Referer"] = prepared.real_url
                    next_url = redirect_url
                    continue

                response.content = content
                response.headers = headers
                response.url = url
                response.status_code = status_code
                response.reason = self._status_reason(status_code)
                response.request = prepared
                return response
        except Exception as exc:
            response.error = response.error or str(exc)
            raise
        finally:
            response.rt = time.perf_counter() - start

    def request(self, **kwargs: Any) -> StandaloneResponse:
        return self.fetch(StandaloneRequest(**kwargs))
