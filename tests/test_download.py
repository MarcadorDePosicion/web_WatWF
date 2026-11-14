import unittest
from scraper.download import SourceError, discover, verify_document


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


if __name__ == '__main__':
    unittest.main()
