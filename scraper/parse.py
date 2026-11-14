"""Import the inspected SWF workbook layout, retaining source coordinates."""
import argparse
from datetime import date, datetime, timedelta
from fnmatch import fnmatchcase
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

import openpyxl

from .download import SourceError, SOURCE_URL, download_sources

ROOT = Path(__file__).resolve().parents[1]
ACADEMIC_YEAR = '2026/2027'
FIRST_YEAR, LAST_YEAR = map(int, ACADEMIC_YEAR.split('/'))
SOURCE_ROLES = {'schedule': 'rozklad_zajec*.xlsx', 'staff': 'plan_obciazenia*.xlsx',
                'guidelines': 'wytyczne*.docx', 'retakes': '*harmonogram_powtarzanie*.xlsx'}
REVISION = re.compile(r'_akt_((?:\d{2})?\d{2}-\d{2}-\d{2})(?:_\d+)?$', re.I)
DAYS = ['PONIEDZIAŁEK', 'WTOREK', 'ŚRODA', 'CZWARTEK', 'PIĄTEK', 'SOBOTA', 'NIEDZIELA']
TIMES = {'1/2': ('08:00', '09:35'), '3/4': ('09:50', '11:25'),
         '5/6': ('11:40', '13:15'), '7/8': ('13:30', '15:05'),
         '9/10': ('16:00', '17:35'), '11/12': ('17:50', '19:25')}
TIME_SOURCE = 'https://wml.wat.edu.pl/siatka-godzin/'
MONTHS = {'IX': 9, 'PAŹDZIERNIK': 10, 'LISTOPAD': 11, 'GRUDZIEŃ': 12, 'STYCZEŃ': 1}
# Codes disambiguated against the names and group assignments in the staff plan.
STAFF_COLUMNS = dict(zip(
    ['C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X',
     'AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU','AV','AW'],
    ['ŻB','AB','KCE','AC','ZC','KC','DD','PF','MGI','RG','MG','MJ','PJ','KK','AK','RK','MKU','JKU','WL','KL','ML','TL',
     'DŁ','PM','RO','RP','MP','PP','GP','AR','PR','WS','PS','NS','MS','JS','MU','MW','MWŁ','JW','AW','SW','MZ','DZ','IB']))
GROUP = re.compile(r'^(\d+)pl[/\\](\d+)kp(.*)$', re.I)


def clean(value):
    return ' '.join(str(value).split()) if value is not None else ''


def load(path):
    return openpyxl.load_workbook(path, data_only=True)


def merged_value(sheet, row, col):
    value = sheet.cell(row, col).value
    if value is not None:
        return value
    for span in sheet.merged_cells.ranges:
        if span.min_row <= row <= span.max_row and span.min_col <= col <= span.max_col:
            return sheet.cell(span.min_row, span.min_col).value
    return None


def legends(path):
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    paragraphs = [clean(''.join(t.text or '' for t in p.findall('.//w:t', ns)))
                  for p in root.findall('.//w:p', ns)]
    if not any('SEMESTRZE ZIMOWYM' in line.upper() and ACADEMIC_YEAR in line.replace(' ', '') for line in paragraphs):
        raise SourceError(f'Wytyczne nie dotyczą semestru zimowego {ACADEMIC_YEAR}.')
    locations, topics, civilian = {}, {}, {}
    for line in paragraphs:
        match = re.fullmatch(r'([A-ZŻ])\s*[–-]\s*(.+?)\s*[–-]\s*obiekt (wewnętrzny|zewnętrzny)', line)
        if match:
            locations[match[1]] = {'name': match[2], 'type': match[3]}
        match = re.fullmatch(r'(\d+)\s*[–-]\s*(.+)', line)
        if match:
            topics[match[1]] = match[2].rstrip('.')
        match = re.match(r'\d+\.\s*([A-Z]+)\s*[–-]\s*(.+)', line)
        if match:
            civilian[match[1]] = match[2].split(' (')[0].rstrip('.')
    if len(locations) < 20 or len(topics) < 10 or len(civilian) < 8:
        raise SourceError('Nie rozpoznano pełnej legendy wytycznych DOCX.')
    for code in ['B1', 'B2', 'B3']:
        locations[code] = {**locations['B'], 'name': locations['B']['name'] + f' — strefa {code}'}
    return locations, topics, civilian


def staff(path):
    sheet = load(path).worksheets[0]
    title = clean(sheet['A1'].value)
    if 'zimowym' not in title or ACADEMIC_YEAR not in title:
        raise SourceError(f'Obciążenie kadry nie dotyczy semestru zimowego {ACADEMIC_YEAR}.')
    names = {code: clean(sheet[f'{column}2'].value) for column, code in STAFF_COLUMNS.items()}
    if any(not name for name in names.values()):
        raise SourceError('Zmieniony układ kolumn obciążenia kadry.')
    # A changed teacher order must not silently assign an old code to a new person.
    for code, surname in {'KC':'Czarkowska', 'KCE':'Cebulak', 'MG':'Gulan', 'MGI':'Gąsiński',
                          'MKU':'Kubajka', 'MWŁ':'Włoch', 'JS':'Szkopiński'}.items():
        if surname not in names[code]:
            raise SourceError(f'Niezgodna kolumna wykładowcy {code}.')
    return names


def group_fields(group):
    match = GROUP.fullmatch(group)
    if match:
        return f'{match[2]} kp', f'{match[1]} pl' + match[3], 'military'
    faculty = re.match(r'^([A-Z]+)\d{2}', group)
    return (faculty[1] if faculty else group), group, 'civilian' if faculty else 'other'


def decode(raw, legend):
    locations, military, civilian = legend
    match = re.fullmatch(r'([A-ZŻ][123]?)-(\d+)[/\\](\d+)', raw)
    if match:
        place, number, lesson = match.groups()
        if place not in locations or number not in military:
            raise SourceError(f'Nieznany kod zajęć: {raw}')
        return (f'{military[number]} — zajęcia {lesson} ({raw})', locations[place]['name'], place,
                'Brak szczegółowego opisu tej lekcji w dostarczonych wytycznych.')
    match = re.fullmatch(r'([A-ZŻ][123]?)-([A-Z]+)', raw)
    if match and match[1] in locations and match[2] in civilian:
        return civilian[match[2]], locations[match[1]]['name'], match[1], ''
    if raw == 'ZO':
        return 'ZO', None, None, 'Kod ZO nie jest objaśniony w dostarczonej legendzie.'
    raise SourceError(f'Nieznane oznaczenie zajęć: {raw}')


def reference(path, sheet, cell):
    return {'file': path.name, 'sheet': sheet.title, 'cell': cell}


def record(day, times, group, teacher, raw, legend, ref, kind='regular', year='', extra=''):
    company, platoon, audience = group_fields(group)
    topic, location, place, note = decode(raw, legend)
    notes = [note, extra]
    if audience == 'military' and place:
        outdoor = legend[0][place]['type'] == 'zewnętrzny'
        notes.append('Jednolity strój sportowy odpowiedni do pogody; bez smartfonów i słuchawek.' if outdoor
                     else 'Obuwie zmienne; wejście do budynku SWF wyłącznie z nauczycielem.')
    return dict(date=day.isoformat(), startTime=times[0], endTime=times[1], company=company,
                platoon=platoon, lecturer=teacher or None, topic=topic, location=location,
                notes=' '.join(n for n in notes if n), group=group, year=year or None,
                kind=kind, audience=audience, sourceCode=raw, locationCode=place, sources=[ref])


def parse_schedule(path, names, legend, report):
    workbook = load(path)
    selected = []
    for sheet in workbook:
        title = clean(sheet['F1'].value)
        if ACADEMIC_YEAR in title and 'zimowy' in title:
            selected.append(sheet)
        else:
            report['excludedSheets'].append({'sheet': sheet.title, 'title': title})
    if len(selected) != 1:
        raise SourceError(f'Oczekiwano jednego arkusza zimowego {ACADEMIC_YEAR}.')
    sheet = selected[0]
    result = []
    dates, block = {}, None
    # Only calendar columns E:V; W contains additional staff codes, not dates.
    for row in range(1, sheet.max_row + 1):
        first = clean(sheet.cell(row, 1).value).replace('\\', '/')
        if first in DAYS:
            if (clean(sheet.cell(row + 1, 1).value), clean(sheet.cell(row + 1, 2).value)) != ('G', 'Nr grupy'):
                raise SourceError(f'Zmieniony nagłówek planu w wierszu {row + 1}.')
            dates, block = {}, None
            month = 9  # first winter column can be an unlabelled September (Wednesday).
            for col in range(5, 23):
                label = clean(merged_value(sheet, row, col))
                month = MONTHS.get(label, month)
                number = clean(sheet.cell(row + 1, col).value)
                if not number.isdigit():
                    raise SourceError(f'Nieprawidłowy nagłówek daty {sheet.title}:{row+1}:{col}')
                header_date = f'{FIRST_YEAR if month >= 9 else LAST_YEAR}-{month:02d}-{int(number):02d}'
                candidate = None
                try:
                    candidate = date.fromisoformat(header_date)
                except ValueError:
                    if not dates:
                        raise SourceError(f'Nieprawidłowa pierwsza data: {header_date}')
                # The Saturday header labels October 31 as November. The weekly
                # day-number sequence is authoritative; record this source defect.
                if dates:
                    previous = dates[col - 1]
                    expected = previous + timedelta(days=7)
                    if expected.day != int(number):
                        raise SourceError('Nieciągły kalendarz tygodniowy w źródle.')
                    if candidate != expected:
                        report['calendarCorrections'].append({'cell': sheet.cell(row+1,col).coordinate,
                            'headerDate': header_date, 'date': expected.isoformat()})
                        candidate = expected
                if candidate.weekday() != DAYS.index(first):
                    raise SourceError(f'Data {candidate} nie odpowiada dniowi {first}.')
                dates[col] = candidate
            if clean(sheet.cell(row + 1, 23).value).isdigit():
                raise SourceError(f'Nowa kolumna kalendarza w wierszu {row + 1}.')
            continue
        if first in TIMES:
            block = first
        elif first in ('G', 'Nr tygodnia', '"ZATWIERDZAM"'):
            block = None
        elif dates and first:
            raise SourceError(f'Nieznany blok godzinowy w wierszu {row}: {first}.')
        group = clean(sheet.cell(row, 2).value)
        if not block or not group:
            continue
        code = clean(sheet.cell(row, 4).value)
        if code and code not in names:
            raise SourceError(f'Nieznany wykładowca: {code}')
        for col, day in dates.items():
            cell = sheet.cell(row, col)
            raw = clean(cell.value)
            if not raw:
                continue
            report['nonEmptyCalendarCells'] += 1
            ref = reference(path, sheet, cell.coordinate)
            if raw in ('ODPRAWA SWF', 'WIGILIA SWF'):
                report['excludedEvents'].append({**ref, 'value': raw})
                continue
            if group == '2 PŁ':
                if raw not in names:
                    raise SourceError(f'Nieznany prowadzący dla 2 PŁ: {raw}')
                item = record(day, TIMES[block], group, names[raw], 'ZO', legend, ref,
                              extra='Źródło podaje tylko prowadzącego; brak tematu i obiektu.')
                item.update(topic='WF — temat niepodany', sourceCode=raw,
                            notes='Źródło podaje tylko prowadzącego; brak tematu i obiektu.')
            else:
                additional = clean(sheet.cell(row, 23).value)
                extra = f'Dodatkowe oznaczenie kadry w kolumnie W: {additional}.' if additional else ''
                item = record(day, TIMES[block], group, names.get(code), raw, legend, ref,
                              year=clean(sheet.cell(row, 3).value), extra=extra)
            result.append(item)
    return result


def parse_retakes(path, legend):
    sheet = load(path).worksheets[0]
    if (clean(sheet['A3'].value).casefold(), clean(sheet['B3'].value).casefold()) != ('godzina', 'rocznik'):
        raise SourceError('Zmienione nagłówki harmonogramu powtarzania WF.')
    if sheet.max_row > 200 or sheet.max_column > 150:
        raise SourceError('Nieobsługiwany rozmiar harmonogramu powtarzania WF.')
    semester_start, semester_end = date(FIRST_YEAR, 9, 1), date(LAST_YEAR, 3, 1)
    groups = []
    for row in range(4, sheet.max_row + 1):
        if clean(sheet.cell(row, 2).value):
            groups.append(row)
        elif any(clean(sheet.cell(row, col).value) for col in range(1, sheet.max_column + 1)):
            raise SourceError(f'Brak rocznika w wierszu {row} harmonogramu powtarzania WF.')
    result = []
    for col in range(3, sheet.max_column + 1, 2):
        if not any(clean(sheet.cell(row, column).value) for row in range(2, sheet.max_row + 1) for column in (col, col + 1)):
            continue
        day = sheet.cell(2, col).value
        headers = tuple(clean(sheet.cell(3, column).value).casefold() for column in (col, col + 1))
        if headers != ('prowadzący', 'temat') or not isinstance(day, datetime):
            raise SourceError(f'Zmieniony układ daty i tematu w kolumnie {col} harmonogramu powtarzania WF.')
        if not semester_start <= day.date() < semester_end:
            raise SourceError(f'Termin powtarzania WF poza semestrem zimowym: {day.date()}.')
        for row in groups:
            hours = clean(merged_value(sheet, row, 1))
            match = re.fullmatch(r'(\d{2})[.:](\d{2})-(\d{2})[.:](\d{2})', hours)
            if not match:
                raise SourceError(f'Nieznane godziny powtarzania: {hours}')
            times = (f'{match[1]}:{match[2]}', f'{match[3]}:{match[4]}')
            if (int(match[1]) > 23 or int(match[3]) > 23 or int(match[2]) > 59
                    or int(match[4]) > 59 or times[0] >= times[1]):
                raise SourceError(f'Nieprawidłowe godziny powtarzania: {hours}.')
            year = clean(sheet.cell(row, 2).value)
            item = record(day.date(), times, 'Powtarzanie WF — '+year,
                          clean(merged_value(sheet, row, col)),
                          clean(merged_value(sheet, row, col+1)), legend,
                          reference(path, sheet, sheet.cell(row,col+1).coordinate),
                          kind='retake', year=year, extra='Powtarzanie przedmiotu WF; godziny z osobnego harmonogramu.')
            item.update(company='Powtarzanie WF', platoon=year)
            result.append(item)
    return result


def finalize(records):
    unique = {}
    for item in records:
        identity = {key: value for key, value in item.items() if key != 'sources'}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]
        if key in unique:
            unique[key]['sources'].extend(item['sources'])
        else:
            unique[key] = {'id': key, **item}
    return sorted(unique.values(), key=lambda x: (x['date'], x['startTime'], x['group'], x['id']))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if path.exists() and path.read_text(encoding='utf-8') == payload:
        return
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=path.parent, delete=False) as file:
        file.write(payload)
        temporary = Path(file.name)
    temporary.replace(path)


def source_role(filename):
    return next((role for role, pattern in SOURCE_ROLES.items()
                 if fnmatchcase(filename.casefold(), pattern)), None)


def revision_date(filename):
    match = REVISION.search(Path(filename).stem)
    if not match:
        return None
    stamp = match[1]
    if len(stamp) == 8:
        stamp = '20' + stamp
    try:
        return date.fromisoformat(stamp)
    except ValueError as exc:
        raise SourceError(f'Nieprawidłowa data rewizji: {filename}.') from exc


def previous_revisions(path):
    if path is None:
        return {}
    metadata = json.loads(path.read_text(encoding='utf-8'))
    sources = metadata.get('sources') if isinstance(metadata, dict) else None
    if not isinstance(sources, list):
        raise SourceError('Metadane opublikowanego planu nie zawierają listy źródeł.')
    revisions = {}
    for item in sources:
        if (not isinstance(item, dict) or not isinstance(item.get('file'), str)
                or not isinstance(item.get('role'), str) or item['role'] not in SOURCE_ROLES):
            raise SourceError('Nieprawidłowe źródło w metadanych opublikowanego planu.')
        role = item['role']
        if role in revisions:
            raise SourceError(f'Powtórzone źródło w metadanych opublikowanego planu: {role}.')
        revisions[role] = revision_date(item['file'])
    if revisions.keys() != SOURCE_ROLES.keys():
        raise SourceError('Niekompletna lista źródeł w metadanych opublikowanego planu.')
    return revisions


def select_online_documents(urls, baseline):
    grouped = {role: [] for role in SOURCE_ROLES}
    for url in urls:
        filename = Path(unquote(urlsplit(url).path)).name
        role = source_role(filename)
        if role is not None:
            grouped[role].append((filename, url))

    selected = []
    for role, documents in grouped.items():
        if not documents:
            raise SourceError(f'Brak wymaganego dokumentu na stronie WAT: {role}.')
        revisions = {filename: revision_date(filename) for filename, _ in documents}
        if len(revisions) > 1 and None in revisions.values():
            raise SourceError(f'Nie można porównać dokumentów {role}: brak daty rewizji w nazwie.')
        latest = max((value for value in revisions.values() if value is not None), default=None)
        previous = baseline.get(role)
        if previous is not None and (latest is None or latest < previous):
            raise SourceError(f'Dokument {role} ma nieznaną lub starszą rewizję niż opublikowana ({previous}).')
        selected.extend(url for filename, url in documents if revisions[filename] == latest)
    return sorted(selected)


def copy_selected_sources(cache, source_dir, manifest):
    selected = {}
    for item in manifest:
        filename = item['originalName']
        role = source_role(filename)
        previous = selected.get(role)
        if previous is not None:
            if previous['sha256'] != item['sha256']:
                raise SourceError(f'Dokumenty {role} z tej samej daty rewizji mają różną treść.')
            continue
        selected[role] = item
        shutil.copyfile(cache / item['file'], source_dir / filename)
    return list(selected.values())


def run(source_dir, output, download_manifest=None):
    files = {}
    paths = [path for path in source_dir.iterdir() if path.is_file()] if source_dir.is_dir() else []
    for role, pattern in SOURCE_ROLES.items():
        candidates = sorted(path for path in paths if source_role(path.name) == role)
        if len(candidates) != 1:
            raise SourceError(f'{role}: oczekiwano jednego pliku {pattern}, znaleziono {len(candidates)}.')
        files[role] = candidates[0]
    legend = legends(files['guidelines'])
    names = staff(files['staff'])
    report = dict(excludedSheets=[], excludedEvents=[], calendarCorrections=[], nonEmptyCalendarCells=0)
    regular = parse_schedule(files['schedule'], names, legend, report)
    retakes = parse_retakes(files['retakes'], legend)
    records = finalize(regular + retakes)
    if not regular or not retakes:
        raise SourceError('Pusty wynik importu; nie zapisano danych.')
    report.update(recordCount=len(records), regularBeforeDeduplication=len(regular), retakes=len(retakes),
                  dateRange=[records[0]['date'], records[-1]['date']],
                  missingLecturer=sum(x['lecturer'] is None for x in records),
                  missingLocation=sum(x['location'] is None for x in records))
    report['conflictingSlots'] = []
    slots = {}
    for item in records:
        key = (item['date'], item['startTime'], item['group'])
        slots.setdefault(key, []).append(item['id'])
    for key, ids in slots.items():
        if len(ids)>1:
            report['conflictingSlots'].append(dict(date=key[0], startTime=key[1], group=key[2], ids=ids))
    if download_manifest is not None and report['conflictingSlots']:
        raise SourceError('Pobrany rozkład zawiera sprzeczne terminy dla tej samej grupy.')
    metadata = dict(schemaVersion=1, timezone='Europe/Warsaw', academicYear=ACADEMIC_YEAR,
                    semester='winter', sourcePage=SOURCE_URL, timeGridSource=TIME_SOURCE,
                    importMode='download' if download_manifest is not None else 'local-files', sources=[dict(role=role, file=p.name,
                    sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for role,p in files.items()],
                    limitations=['Pełne opisy poszczególnych lekcji nie są dostępne; zachowano ich numery i kody.',
                                 'Puste lecturer/location oznaczają brak danych, nie brak zajęć.',
                                 'Kolumna W zachowana jako uwaga; brak reguł przypisania zastępstw do dat.'],
                    report=report)
    if download_manifest is not None:
        metadata['downloadManifest'] = download_manifest
    else:
        metadata['limitations'].append('Aktualność plików względem strony WAT nie została potwierdzona online.')
    write_json(output.with_name('schedule.meta.json'), metadata)
    write_json(output, records)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT/'data/sources')
    parser.add_argument('--output', type=Path, default=ROOT/'data/schedule.json')
    parser.add_argument('--download', action='store_true', help='Pobierz źródła ze strony WAT przed parsowaniem.')
    parser.add_argument('--baseline', type=Path, help='Metadane opublikowanego planu do kontroli dat rewizji przy --download.')
    args = parser.parse_args()
    if args.baseline is not None and not args.download:
        parser.error('--baseline wymaga --download.')
    try:
        if args.download:
            with tempfile.TemporaryDirectory() as directory:
                cache = Path(directory)/'downloads'
                baseline = previous_revisions(args.baseline)
                manifest = download_sources(cache, select=lambda urls: select_online_documents(urls, baseline))
                source_dir = Path(directory)/'sources'
                source_dir.mkdir()
                selected = copy_selected_sources(cache, source_dir, manifest)
                report = run(source_dir, args.output, selected)
        else:
            report = run(args.source_dir, args.output)
    except (SourceError, ValueError, OSError, BadZipFile, ET.ParseError, openpyxl.utils.exceptions.InvalidFileException) as exc:
        parser.exit(1, f'Błąd importu: {exc}\n')
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
