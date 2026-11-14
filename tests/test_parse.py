import json
from pathlib import Path
import tempfile
import unittest
from datetime import date
from scraper.parse import ROOT, legends, decode, run, SourceError


class RealSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temp.name)/'schedule.json'
        cls.report = run(ROOT/'data/sources', cls.output)
        cls.records = json.loads(cls.output.read_text(encoding='utf-8'))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_source_coverage(self):
        self.assertEqual(self.report['nonEmptyCalendarCells'], 6201)
        self.assertEqual(len(self.records), 6209)
        self.assertEqual(self.report['regularBeforeDeduplication'] + len(self.report['excludedEvents']), 6201)
        self.assertEqual(self.report['conflictingSlots'], [])

    def test_known_military_cell(self):
        item = next(x for x in self.records if x['sources'][0]['cell']=='F7')
        self.assertEqual((item['date'],item['startTime'],item['endTime']), ('2026-10-05','08:00','09:35'))
        self.assertEqual((item['company'],item['platoon']), ('14 kp','1 pl'))
        self.assertEqual(item['lecturer'], 'mgr Waldemar Stangret')
        self.assertEqual(item['sourceCode'], 'H-7/8')
        self.assertEqual(item['location'], 'duża hala')

    def test_retake_merged_cells_and_actual_hours(self):
        items = [x for x in self.records if x['kind']=='retake']
        self.assertEqual(len(items), 12)
        item = next(x for x in items if x['date']=='2026-11-14' and x['platoon']=='II rok')
        self.assertEqual((item['startTime'],item['endTime']), ('08:00','09:30'))
        self.assertEqual(item['lecturer'], 'mgr Dawid ZAPŁATA')
        self.assertEqual(item['sourceCode'], 'S-3/4')

    def test_old_summer_and_staff_events_not_lessons(self):
        self.assertEqual(self.report['excludedSheets'][0]['title'], 'Rok akademicki 2025/2026 - semestr letni')
        self.assertFalse(any(x['sourceCode'] in ('ODPRAWA SWF','WIGILIA SWF') for x in self.records))
        self.assertEqual(self.report['calendarCorrections'][0]['date'], '2026-10-31')

    def test_required_fields_dates_times_and_unique_ids(self):
        required = {'id','date','startTime','endTime','company','platoon','lecturer','topic','location','notes'}
        self.assertEqual(len({x['id'] for x in self.records}),len(self.records))
        for item in self.records:
            self.assertTrue(required.issubset(item))
            day = date.fromisoformat(item['date'])
            self.assertTrue(date(2026,9,1) <= day <= date(2027,2,28))
            self.assertRegex(item['startTime'], r'^\d{2}:\d{2}$')
            self.assertLess(item['startTime'], item['endTime'])

    def test_reimport_is_byte_identical(self):
        before = self.output.read_bytes()
        run(ROOT/'data/sources', self.output)
        self.assertEqual(before,self.output.read_bytes())

    def test_failed_import_preserves_previous_data(self):
        before = self.output.read_bytes()
        with self.assertRaises(SourceError):
            run(Path(self.temp.name)/'missing',self.output)
        self.assertEqual(before,self.output.read_bytes())

    def test_unknown_topic_is_rejected(self):
        path = next((ROOT/'data/sources').glob('wytyczne*.docx'))
        with self.assertRaises(SourceError):
            decode('P-99/1',legends(path))


if __name__ == '__main__':
    unittest.main()
