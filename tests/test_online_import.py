import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import openpyxl

from scraper.download import SOURCE_URL, SourceError
from scraper.parse import ROOT, legends, main, parse_retakes, revision_date, select_online_documents, source_role


SOURCE_FILES = {source_role(path.name): path for path in (ROOT / 'data/sources').iterdir()}
MEDIA = 'https://www.wojsko-polskie.pl/media/'


def mock_sw_site(files):
    links = ''.join(f'<a href="{url}">Załącznik</a>' for url in files)
    return {SOURCE_URL: links.encode(), **files}


class OnlineImportTests(unittest.TestCase):
    def test_retake_schedule_imports_a_new_date_column(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'retakes.xlsx'
            workbook = openpyxl.load_workbook(SOURCE_FILES['retakes'])
            sheet = workbook.worksheets[0]
            for row in range(2, 8):
                sheet.cell(row, 9).value = sheet.cell(row, 7).value
                sheet.cell(row, 10).value = sheet.cell(row, 8).value
            sheet['I2'] = datetime(2026, 11, 28)
            for cells in ('I2:J2', 'I4:I7', 'J4:J5', 'J6:J7'):
                sheet.merge_cells(cells)
            workbook.save(path)
            records = parse_retakes(path, legends(SOURCE_FILES['guidelines']))
            added = [entry for entry in records if entry['date'] == '2026-11-28']
            self.assertEqual(len(added), 4)
            self.assertEqual({entry['startTime'] for entry in added}, {'08:00', '09:50'})

    def test_selection_rejects_a_downgrade_or_unranked_revision(self):
        urls = [MEDIA + path.name for path in SOURCE_FILES.values()]
        schedule = MEDIA + SOURCE_FILES['schedule'].name
        baseline = {role: revision_date(path.name) for role, path in SOURCE_FILES.items()}
        older = schedule.replace('2026-10-22', '26-10-01')
        undated = schedule.replace('_akt_2026-10-22', '')
        other_roles = [url for url in urls if url != schedule]
        with self.assertRaisesRegex(SourceError, 'starszą rewizję'):
            select_online_documents(other_roles + [older], baseline)
        with self.assertRaisesRegex(SourceError, 'brak daty rewizji'):
            select_online_documents(urls + [undated], baseline)

    def test_online_import_chooses_revision_and_preserves_outputs_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            output = path / 'schedule.json'
            metadata = path / 'schedule.meta.json'
            baseline = path / 'baseline.meta.json'
            sources = [{'role': role, 'file': file.name} for role, file in SOURCE_FILES.items()]
            baseline.write_text(json.dumps({'sources': sources}), encoding='utf-8')
            originals = {MEDIA + file.name: file.read_bytes() for file in SOURCE_FILES.values()}
            revised_name = SOURCE_FILES['schedule'].name.replace('2026-10-22', '2026-11-02')
            revised_url = MEDIA + revised_name
            workbook = openpyxl.load_workbook(SOURCE_FILES['schedule'])
            workbook.worksheets[0]['F7'] = 'P-5/13'
            revised = io.BytesIO()
            workbook.save(revised)
            aliases = {revised_url: revised.getvalue(), revised_url + '?download=1': revised.getvalue()}
            pages = mock_sw_site({**originals, **aliases, MEDIA + 'regulamin.pdf': b'irrelevant'})
            args = ['scraper.parse', '--download', '--baseline', str(baseline), '--output', str(output)]

            with patch('sys.argv', args), patch('scraper.download.fetch', side_effect=pages.__getitem__) as fetch:
                with redirect_stdout(io.StringIO()):
                    main()
                fetched = {call.args[0] for call in fetch.call_args_list}
                self.assertIn(revised_url, fetched)
                self.assertNotIn(MEDIA + SOURCE_FILES['schedule'].name, fetched)
                self.assertNotIn(MEDIA + 'regulamin.pdf', fetched)

            records = json.loads(output.read_text(encoding='utf-8'))
            updated = next(item for item in records if item['sources'][0]['cell'] == 'F7')
            self.assertEqual(updated['sourceCode'], 'P-5/13')
            self.assertEqual(updated['sources'][0]['file'], revised_name)
            provenance = json.loads(metadata.read_text(encoding='utf-8'))
            self.assertEqual(provenance['report']['recordCount'], len(records))
            self.assertEqual(len(provenance['downloadManifest']), 4)

            before = (output.read_bytes(), metadata.read_bytes())
            with patch('sys.argv', args), patch('scraper.download.fetch', side_effect=pages.__getitem__):
                with redirect_stdout(io.StringIO()):
                    main()
            self.assertEqual(before, (output.read_bytes(), metadata.read_bytes()))

            conflicting = mock_sw_site({**originals, **aliases, revised_url + '?download=1': originals[MEDIA + SOURCE_FILES['schedule'].name]})
            with patch('sys.argv', args), patch('scraper.download.fetch', side_effect=conflicting.__getitem__):
                with redirect_stderr(io.StringIO()), self.assertRaisesRegex(SystemExit, '1'):
                    main()
            with patch('sys.argv', args), patch('scraper.download.fetch', return_value=b'Please enable JavaScript'):
                with redirect_stderr(io.StringIO()), self.assertRaisesRegex(SystemExit, '1'):
                    main()
            self.assertEqual(before, (output.read_bytes(), metadata.read_bytes()))
