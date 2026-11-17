# WAT WF Plan

WAT WF Plan to aplikacja webowa do przeglądania planu zajęć wychowania fizycznego na Wojskowej Akademii Technicznej. Zbiera w jednym miejscu terminy, obiekty, prowadzących i uwagi z rozkładów Studium Wychowania Fizycznego. Plan można zawęzić do swojej grupy, dodać do ekranu głównego telefonu i przeglądać offline.

## Funkcje

- Dzienny plan z tygodniowym paskiem dat, godzinami zajęć i kolorami obiektów sportowych.
- Wyszukiwanie także bez polskich znaków i powiązane filtry kompanii, wydziału, grupy oraz prowadzącego. Wybór zapisuje się w przeglądarce.
- Karta „Najbliższe zajęcia” z odliczaniem uwzględniającym strefę czasową Warszawy.
- Instalacja jako aplikacja PWA na iOS i Androidzie. Po pierwszym otwarciu z dostępem do internetu aplikacja zapisuje rozkład do użytku offline.

## Przypomnienia i kalendarz

Po wybraniu grupy lub prowadzącego panel „Przypomnienia i kalendarz” pozwala włączyć powiadomienia na 15, 30 lub 60 minut przed zajęciami. Powiadomienie zawiera godzinę, temat i miejsce. Przeglądarka potrzebuje zgody na powiadomienia, a aplikacja musi być otwarta i aktywna. Na iOS powiadomienia są dostępne w aplikacji dodanej do ekranu głównego.

Plik `wat-wf-plan.ics` zawiera terminy pasujące do filtrów. Każdy termin ma alert ustawiony na 30 minut przed zajęciami. Po imporcie przypomnienia obsługuje kalendarz telefonu, również po zamknięciu planu. Zależą one od zachowania alertu podczas importu i od ustawień powiadomień kalendarza. Plik jest kopią planu z chwili eksportu. [Import na iPhonie](https://support.apple.com/en-euro/guide/iphone/ipha0d932e96/27/ios/27) · [Import do Kalendarza Google](https://support.google.com/calendar/answer/37118?hl=pl)

## Dane i aktualizacje

Źródłami są rozkład zajęć, obciążenie kadry, wytyczne i harmonogram powtarzania WF. Wersja dołączona do projektu obejmuje semestr zimowy 2026/2027. [Rozkłady zajęć SWF WAT](https://www.wojsko-polskie.pl/wat/swf-rozklady-zajec/)

Importer w Pythonie odczytuje arkusze XLSX i wytyczne DOCX, a aplikacja korzysta z [planu w formacie JSON](data/schedule.json). [Metadane](data/schedule.meta.json) wskazują pliki źródłowe, daty i braki w rozkładzie. Każdy wpis zachowuje oznaczenie lekcji oraz adres komórki, z której pochodzi. Jeśli źródło nie podaje prowadzącego, obiektu lub szczegółowego tematu, plan zachowuje tylko dostępną informację.

[Workflow aktualizacji](.github/workflows/update-schedule.yml) sprawdza dokumenty codziennie o 06:17 czasu warszawskiego. Po pomyślnej walidacji zapisuje zmieniony plan i metadane w jednym commicie. W razie blokady strony WAT lub nierozpoznanego formatu zachowuje ostatni plan. Ręczne uruchomienie z opcją `dry_run` sprawdza źródło bez tworzenia commita. Parser obsługuje układ dokumentów z zimy 2026/2027.

## Uruchomienie lokalne

Frontend korzysta z HTML, modułów JavaScript i skompilowanego Tailwind CSS. Do podglądu wystarczy Python 3.11 lub nowszy. Polecenie zakłada, że bieżący katalog zawiera plik `index.html`.

```sh
python -m http.server 8080 --bind 127.0.0.1
```

Podgląd jest dostępny pod [http://127.0.0.1:8080/](http://127.0.0.1:8080/). Instalacja PWA na telefonie wymaga wdrożenia pod adresem HTTPS. Aplikacja może być hostowana jako statyczna strona, na przykład w GitHub Pages.

## Rozwój i testy

Kompilacja stylów i testy frontendu wymagają Node.js 22+ oraz pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm run build:css
pnpm run check
```

Testy importera korzystają z dokumentów zapisanych w `data/sources/` i działają bez połączenia z serwisem WAT. Poniższe polecenia instalują zależności, uruchamiają testy i zapisują próbny import w katalogu `.cache/`.

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m scraper.parse --output .cache/preview/schedule.json
```

Źródłowe style znajdują się w `styles/input.css`, a wynik kompilacji w `styles/app.css`. Zmiana plików zapisanych do użytku offline wymaga zwiększenia `CACHE_VERSION` w `sw.js`.
