"""Discover source files; never treat an anti-bot response as a schedule."""

import argparse
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import Request, urlopen

SOURCE_URL = "https://www.wojsko-polskie.pl/wat/swf-rozklady-zajec/"
EXTENSIONS = {".xlsx", ".xls", ".pdf", ".docx"}
MAX_BYTES = 30 * 1024 * 1024


class SourceError(RuntimeError):
    """Source unavailable or not a verified source document."""


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def check_page(html):
    lowered = html.lower()
    markers = ("_incapsula_resource", "jaki kod widzisz", "please enable javascript",
               "trwają prace konserwacyjne", "your support id is")
    if any(marker in lowered for marker in markers):
        raise SourceError("WAT zwrócił zabezpieczenie antybotowe lub stronę konserwacji. "
                          "Nie pobrano planu. Istniejące dane pozostają bez zmian.")


def discover(html, base_url):
    check_page(html)
    parser = Links()
    parser.feed(html)
    documents, pages = set(), set()
    for href in parser.links:
        url = urljoin(base_url, href).split("#", 1)[0]
        parts = urlsplit(url)
        if parts.scheme != "https":
            continue
        suffix = Path(unquote(parts.path)).suffix.lower()
        if suffix in EXTENSIONS:
            documents.add(url)
        elif (parts.netloc == urlsplit(SOURCE_URL).netloc
              and parts.path.startswith("/wat/swf-") and url != base_url):
            pages.add(url)
    return sorted(documents), sorted(pages)


def fetch(url):
    request = Request(url, headers={"User-Agent": "WAT-WF-Plan/0.1 (schedule source importer)"})
    try:
        with urlopen(request, timeout=45) as response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise SourceError(f"Plik przekracza limit 30 MiB: {url}")
            return body
    except (HTTPError, URLError, TimeoutError) as exc:
        raise SourceError(f"Nie można pobrać {url}: {exc}") from exc


def verify_document(body, suffix):
    signatures = {".pdf": b"%PDF-", ".xlsx": b"PK\x03\x04", ".docx": b"PK\x03\x04",
                  ".xls": bytes.fromhex("D0CF11E0A1B11AE1")}
    if not body.startswith(signatures[suffix]):
        raise SourceError(f"Odpowiedź nie jest plikiem {suffix}; możliwa blokada serwera.")


def download_sources(directory):
    html = fetch(SOURCE_URL).decode("utf-8-sig", errors="replace")
    documents, pages = discover(html, SOURCE_URL)
    document_urls = set(documents)
    # One level of linked SWF pages, not an unrestricted site crawler.
    for url in pages:
        child = fetch(url).decode("utf-8-sig", errors="replace")
        found, _ = discover(child, url)
        document_urls.update(found)
    if not document_urls:
        raise SourceError("Brak linków XLSX/XLS/PDF. Wymagana analiza HTML lub nowego układu strony.")
    directory.mkdir(parents=True, exist_ok=True)
    manifest = []
    for url in sorted(document_urls):
        suffix = Path(unquote(urlsplit(url).path)).suffix.lower()
        body = fetch(url)
        verify_document(body, suffix)
        digest = hashlib.sha256(body).hexdigest()
        filename = digest + suffix
        (directory / filename).write_bytes(body)
        manifest.append({"url": url, "file": filename, "sha256": digest,
                         "originalName": Path(unquote(urlsplit(url).path)).name})
    (directory / "sources.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".cache/wat"))
    args = parser.parse_args()
    try:
        manifest = download_sources(args.output)
    except SourceError as exc:
        parser.exit(1, f"Błąd źródła: {exc}\n")
    print(f"Pobrano {len(manifest)} dokumentów do {args.output}.")
    print("Dokumenty wymagają analizy układu przed implementacją parsera schedule.json.")


if __name__ == "__main__":
    main()
