import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.request import Request

from scraper.download import (
    SOURCE_URL, SourceError, SourceRedirectHandler, discover, download_sources, verify_document,
)


class DownloadTests(unittest.TestCase):
    def test_antibot_response_is_rejected(self):
        with self.assertRaises(SourceError):
            discover('<script src="/_Incapsula_Resource"></script>', 'https://example.org/')

    def test_maintenance_is_rejected(self):
        with self.assertRaises(SourceError):
            discover('Aktualnie trwają prace konserwacyjne.', 'https://example.org/')

    def test_relative_encoded_links_and_duplicates(self):
        documents, pages = discover(
            '<a href="/media/plan%20WF.XLSX?v=2">Plan</a>'
            '<a href="/media/plan%20WF.XLSX?v=2">Plan</a>'
            '<a href="/wat/swf-kadra/">Kadra</a>'
            '<a href="https://example.org/other/">Inne</a>',
            'https://www.wojsko-polskie.pl/wat/swf-rozklady-zajec/')
        self.assertEqual(documents, ['https://www.wojsko-polskie.pl/media/plan%20WF.XLSX?v=2'])
        self.assertEqual(pages, ['https://www.wojsko-polskie.pl/wat/swf-kadra/'])

    def test_html_masquerading_as_excel_is_rejected(self):
        with self.assertRaises(SourceError):
            verify_document(b'<html>blocked</html>', '.xlsx')

    def test_discovery_ignores_untrusted_document_origins(self):
        documents, _ = discover(
            '<a href="https://example.org/plan.xlsx">Inny serwer</a>'
            '<a href="https://www.wojsko-polskie.pl.evil.test/plan.xlsx">Podobna domena</a>'
            '<a href="https://other@www.wojsko-polskie.pl/plan.xlsx">Z danymi logowania</a>'
            '<a href="https://www.wojsko-polskie.pl:8080/plan.xlsx">Inny port</a>'
            '<a href="http://www.wojsko-polskie.pl/plan.xlsx">HTTP</a>'
            '<a href="https://wojsko-polskie.pl/wat/plan.xlsx">Oficjalny plik</a>',
            SOURCE_URL,
        )
        self.assertEqual(documents, ['https://wojsko-polskie.pl/wat/plan.xlsx'])

    def test_redirect_does_not_leave_official_https_origin(self):
        handler = SourceRedirectHandler()
        request = Request(SOURCE_URL)
        for invalid in ('https://elsewhere.test/plan.xlsx', 'http://wojsko-polskie.pl/plan.xlsx'):
            with self.assertRaises(SourceError):
                handler.redirect_request(request, None, 302, 'Found', {}, invalid)
        valid = 'https://wojsko-polskie.pl/wat/plan.xlsx'
        redirected = handler.redirect_request(request, None, 302, 'Found', {}, valid)
        self.assertEqual(redirected.full_url, valid)

    def test_downloader_selects_before_fetching_any_document(self):
        archive = 'https://www.wojsko-polskie.pl/wat/archive.xlsx'
        child = 'https://www.wojsko-polskie.pl/wat/swf-informacje/'
        latest = 'https://www.wojsko-polskie.pl/wat/latest.xlsx'
        pages = {
            SOURCE_URL: f'<a href="{archive}">Starszy plan</a><a href="{child}">Informacje</a>'.encode(),
            child: f'<a href="{latest}">Plan</a>'.encode(),
            latest: b'PK\x03\x04sample',
        }
        with TemporaryDirectory() as directory, patch('scraper.download.fetch', side_effect=pages.__getitem__) as fetch:
            def select(urls):
                self.assertEqual(urls, [archive, latest])
                self.assertEqual(fetch.call_count, 2)
                return [latest]

            result = download_sources(Path(directory), select=select)
            self.assertEqual([item['url'] for item in result], [latest])
            self.assertEqual([call.args[0] for call in fetch.call_args_list], [SOURCE_URL, child, latest])


if __name__ == '__main__':
    unittest.main()
