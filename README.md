# WAT WF Plan — etap 5

## Podgląd aplikacji

Z katalogu repozytorium uruchom:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Otwórz http://127.0.0.1:8080/ w przeglądarce. Gotowy CSS jest w repozytorium,
więc do samego podglądu nie trzeba instalować Node.js ani pakietów. Nie otwieraj
`index.html` przez `file://`, ponieważ przeglądarka musi pobrać plik JSON przez HTTP.
Serwer zatrzymasz skrótem Ctrl+C.

Interfejs używa lokalnie skompilowanego Tailwind CSS i modułów JavaScript.
Pokazuje dzienną oś czasu wszystkich grup, wybór daty i tygodniowy pasek dni.
Karty mają temat, obiekt oznaczony kolorem i tekstem, grupę, prowadzącego,
godziny oraz rozwijane uwagi i źródła. Obsługiwane są stany ładowania,
błędu z ponowieniem, pustego pliku i dnia bez wpisów. Braki danych nie są
zastępowane domyślnym prowadzącym ani obiektem.

Wyszukiwarka dopasowuje grupę, temat, obiekt i prowadzącego także bez polskich
znaków. Listy kompanii lub wydziałów, plutonów lub grup i prowadzących ograniczają
się wzajemnie. Pola wyboru oraz tekst zapytania zapisują się w danej przeglądarce
i wracają po odświeżeniu. Przycisk „Wyczyść filtry” przywraca plan wszystkich grup.

Plan otwiera się na dzisiejszej dacie w Warszawie, ograniczonej do zakresu rozkładu.
Jeśli aktywne filtry wykluczają wszystkie wpisy z wybranego dnia, plan przechodzi
do dnia najbliższych pasujących zajęć lub do ostatniego pasującego dnia z danych.
Kalendarz pozwala też ręcznie przejść do dnia bez wpisów.

Karta „Najbliższe zajęcia” wyszukuje następny pasujący termin w całym rozkładzie,
niezależnie od dnia otwartego w kalendarzu. Odliczanie uwzględnia strefę
Europe/Warsaw i aktualizuje się co sekundę. Po rozpoczęciu zajęć karta przechodzi
do kolejnego terminu. Bez filtrów uwzględnia wszystkie grupy.

### Przypomnienia i kalendarz

Wybierz pluton, grupę lub prowadzącego i rozwiń „Przypomnienia i kalendarz”.
Do przypomnień oraz eksportu trafiają zajęcia pasujące do bieżących filtrów
z całego rozkładu. Wyczyść pole wyszukiwania, jeśli chcesz uwzględnić wszystkie
zajęcia przypisane do wybranej grupy lub osoby. Zmiana filtrów synchronizuje się
między kartami tej samej przeglądarki.

- **Powiadomienia webowe.** Wybierz 15, 30 lub 60 minut i naciśnij „Włącz
  powiadomienia”. Przeglądarka poprosi o zgodę. Powiadomienie zawiera temat,
  obiekt i godzinę, a jego kliknięcie otwiera odpowiedni dzień. Aplikacja
  zapamiętuje ustawienia na urządzeniu. Na iOS używaj wersji dodanej do
  ekranu głównego. Przypomnienia działają, gdy otwarta aplikacja może
  wykonywać kod. Po uśpieniu lub zamknięciu aplikacji użyj alertów kalendarza.
- **Kalendarz telefonu.** Pobierz `wat-wf-plan.ics`. Każdy termin zawiera
  `VALARM` z wyprzedzeniem 30 minut. Plik można zaimportować na iPhonie
  z załącznika w Mail lub na komputerze w Kalendarzu Google i zsynchronizować
  z telefonem. Po imporcie sprawdź, czy alert pojawił się przy wydarzeniu
  i czy kalendarz ma dostęp do powiadomień. Jeśli kalendarz pominął alert,
  ustaw przypomnienie 30 minut przed wydarzeniem w jego ustawieniach. Plik
  zawiera plan z chwili eksportu. Po zmianie planu pobierz nowy plik i zastąp
  stare wydarzenia w kalendarzu.

Instrukcje importu udostępniają [Apple](https://support.apple.com/en-euro/guide/iphone/ipha0d932e96/27/ios/27)
i [Kalendarz Google](https://support.google.com/calendar/answer/37118?hl=pl).

### Instalacja i plan offline

Na telefonie otwórz plan pod adresem **HTTPS** i naciśnij „Zainstaluj aplikację”.
Instrukcja w aplikacji pokazuje kroki dla Safari na iOS i Chrome na Androidzie.
Po dodaniu ikony do ekranu głównego otwórz ją raz z dostępem do internetu.
W tym widoku poczekaj na komunikat „Plan dostępny offline”.
Kroki instalacji opisują także [Apple Support](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26)
oraz [Pomoc Google Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=pl).

Do testu na komputerze wystarczy `http://127.0.0.1:8080/`. Zaczekaj na
komunikat o dostępności offline, przełącz sieć na „Offline” w narzędziach
deweloperskich i odśwież stronę zwykłym odświeżeniem. Plan, filtry i kalendarz
mają pozostać dostępne. Adres komputera w sieci lokalnej po zwykłym HTTP nie
zastępuje HTTPS przy testowaniu na telefonie.

Service worker zapisuje pliki aplikacji, plan i metadane. Przy odświeżeniu
próbuje pobrać aktualny plan, a gdy pobranie się nie powiedzie, używa zapisanej
wersji. Wyczyszczenie danych witryny usuwa również zapis dla trybu offline.
Po zmianie plików aplikacji zwiększ `CACHE_VERSION` w `sw.js`, aby nowa wersja
trafiła do pamięci podręcznej. Zamknij wcześniejsze karty aplikacji i otwórz ją
ponownie, aby aktywować przygotowaną aktualizację. Zmiana samych danych planu
jest pobierana przy odświeżeniu bez zwiększania wersji aplikacji.

### Rozwój frontendu

Do kompilacji użyj Node.js 22+ i pnpm 11. Po zmianie HTML, JS lub `styles/input.css`:

```powershell
pnpm install --frozen-lockfile
pnpm run build:css
pnpm run check
```

Zapisuj w commicie także `styles/app.css`. Pakiety Tailwind są przypięte do
wersji 4.1.18; aplikacja nie pobiera stylów, fontów ani skryptów z CDN.
Opcjonalny skrypt budowania @parcel/watcher jest wyłączony; używany jest
dostarczany przez pakiet moduł dla platformy. Jednorazowa kompilacja CSS
nie wymaga trybu obserwowania zmian.

Testy Node.js obejmują indeksowanie, poprawność danych, powiązania filtrów,
wyszukiwanie bez polskich znaków, zapis wyboru i odliczanie przy zmianie czasu.
Testy service workera sprawdzają uruchomienie planu offline, zastąpienie danych
po udanej aktualizacji i zachowanie zapisanej wersji przy błędzie pobrania.

## Pobieranie i parsowanie danych — etap 1

Parser dokumentów SWF WAT. Wynik: `data/schedule.json` (tablica rekordów)
oraz `data/schedule.meta.json` (pochodzenie i raport jakości).

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
