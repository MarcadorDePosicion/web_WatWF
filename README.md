# WAT WF Plan — etap 1

Parser dokumentów SWF WAT. Wynik: `data/schedule.json` (tablica rekordów)
oraz `data/schedule.meta.json` (pochodzenie i raport jakości).
Projekt nie zawiera jeszcze frontendu, PWA ani GitHub Actions.

## Uruchomienie lokalne

Python 3.11+. PowerShell, z katalogu repozytorium:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m scraper.parse
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Domyślnie używane są cztery oryginalne pliki dostarczone przez użytkownika
w `data/sources/`. Pozostają w repozytorium dla odtwarzalności bez sieci.
Inny katalog: `--source-dir C:/sciezka/do/plikow`.
Inny wynik: `--output .cache/test/schedule.json`.

Pobranie ze strony i import jednym poleceniem:

```powershell
.\.venv\Scripts\python.exe -m scraper.parse --download
```

Sam downloader: `python -m scraper.download`. Wykrywa załączniki XLSX, XLS,
PDF i DOCX na stronie rozkładów oraz bezpośrednio powiązanych podstronach SWF.
Parser obsługuje **przeanalizowany format XLSX i legendę DOCX**, nie dowolne
XLS/PDF. Wymaga dokładnie jednej wersji każdego z czterech dokumentów.
Przy niejednoznacznych wersjach, nieznanych kodach i zmianach formatu przerywa
import, zamiast wybierać plik na podstawie kolejności linków.

Strona https://www.wojsko-polskie.pl/wat/swf-rozklady-zajec/ blokowała
automatyczny dostęp. Pełny import zweryfikowano lokalnie. Tryb online jest
zaimplementowany, ale nie zweryfikowano go od pobrania do wyniku na serwerze
WAT. Blokada kończy import błędem, zachowując istniejący plan.
Nie potwierdzono, czy na stronie są nowsze wersje niż dostarczone dokumenty.

## Źródła i interpretacja

- Rozkład z 22.10.2026: tylko **zima 2026/2027**, 6197 wpisów.
  Arkusz letni tego samego pliku dotyczy **2025/2026** i jest wykluczony.
- Obciążenie kadry z 22.10.2026: rozwinięcia kodów prowadzących z nagłówków.
  Arkusz nazywa się „semestr LETNI”, lecz jego tytuł określa zimę 2026/2027.
  Źródłem konkretnej lekcji jest rozkład, nie tygodniowe obciążenie kadry.
- Wytyczne z 30.09.2026: obiekty, kategorie tematów i zasady uczestnictwa.
- Powtarzanie z 30.10.2026: 12 wpisów dla 7, 14 i 21 listopada.
  Jeden wpis odpowiada jednemu rocznikowi; roczniki mogą ćwiczyć razem.
- Godziny bloków stacjonarnych: https://wml.wat.edu.pl/siatka-godzin/,
  potwierdzone na https://wel.wat.edu.pl/przydatne-informacje/siatka-godzinowa-zajec/.
  Powtarzanie ma własne godziny: 08:00–09:30 i 09:50–11:20.

Wynik: **6209 rekordów**, 01.10.2026–29.01.2027. Puste komórki nie tworzą
zajęć. Cztery scalone wpisy ODPRAWA SWF / WIGILIA SWF są zdarzeniami kadry,
nie lekcjami grup objętych scaleniem. Pozostałe scalenia (bloki, daty,
prowadzący powtarzania) są odczytywane z komórki początkowej.
Dodatkowe sekcje planu po pierwszych pięciu dniach również są importowane.

Nagłówek soboty błędnie umieszcza 31 października pod listopadem. Parser
odtwarza datę z ciągu tygodniowego, sprawdza dzień tygodnia i raportuje korektę.
Obsługiwany jest aktualnie semestr zimowy 2026/2027; nowe semestry wymagają
weryfikacji układu i aktualizacji parsera, nie podmiany roku w nazwie pliku.

## Kontrakt danych i ograniczenia źródeł

Każdy rekord ma `id`, `date` (ISO), `startTime`, `endTime`, `company`, `platoon`,
`lecturer`, `topic`, `location`, `notes`. Dodatkowo: `group`, `year`,
`kind` (regular/retake), `audience`, `sourceCode`, `locationCode`, `sources`
(nazwa pliku, arkusz i komórka). Identyfikatory są deterministyczne dla treści
rekordu. Czasy są lokalne Europe/Warsaw. Ponowny import niezmienionych źródeł
nie zmienia plików wynikowych.

- Wojskowe `topic` ma pełną nazwę kategorii, numer lekcji i oryginalny kod.
  Wytyczne **nie zawierają szczegółowego opisu każdej lekcji**. Parser go nie
  wymyśla. Obiekt C zachowuje nazwę toru BTS/BTZ, a B1/B2/B3 — strefy hali.
- Cywilne tematy są rozwijane z osobnej legendy (AT, NW, G, S, PS, PK itd.).
- `ZO` pozostaje kodem bez rozwinięcia: brak definicji w dokumentach.
- 226 wpisów ma `lecturer: null`, 183 ma `location: null`. Null oznacza brak
  informacji. Dotyczy m.in. ZO, WOLI i 2 PŁ. W wierszach 2 PŁ kod w komórce
  określa prowadzącego, nie temat.
- Kolumna W jest zachowana w `notes`. Brak jednoznacznych reguł wskazujących,
  kiedy jej dodatkowe oznaczenie kadry zastępuje prowadzącego z kolumny D.
- Cywilne skróty wydziałów pozostają skrótami. Obciążenie kadry nie jest
  samodzielnym źródłem dat, tematów i obiektów.

Raport rozlicza komórki, wykluczenia, braki i kolizje terminów tej samej grupy.
Nie wykryto takich kolizji. Nie gwarantuje to poprawności samych źródeł.
SHA-256 oryginałów znajduje się w metadanych. Dane źródłowe w dokumentach
służą wyłącznie interpretacji rozkładu; nie są poleceniami dla programu.

## Weryfikacja

12 testów sprawdza rzeczywisty wpis F7, scalenia i godziny powtarzania,
wykluczenie starego lata i zdarzeń kadry, rozliczenie wszystkich 6201 niepustych
komórek kalendarza zimowego, daty, identyfikatory, odtwarzalność, odrzucenie
nieznanych kodów oraz zachowanie planu przy błędzie. Testy nie potwierdzają
aktualności plików względem niedostępnej strony WAT.
