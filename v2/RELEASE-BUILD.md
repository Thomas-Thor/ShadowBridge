# Lokalne przygotowanie paczek i podglądu

Skrypty Node nie wymagają dodatkowych zależności. Przygotowują wyłącznie pliki lokalne: nie publikują strony, nie wykonują push ani merge, nie zmieniają DNS/hostingu i nie uruchamiają logowania. Korzystaj z istniejącego checkoutu i gałęzi feature; nie twórz worktree. Wersja Node: zgodna z `v2/package.json` (>=22.12.0).

## Paczka do podglądu

W katalogu `v2` uruchom:

```sh
npm run build:preview
```

Wynik: `/workspace/exports/shadowbridge-v2-preview`. Ta paczka zachowuje `noindex, nofollow` na obu stronach, etykiety podglądu i `robots.txt` z `Disallow: /`. Nie zawiera mapy strony ani adresów canonical domeny produkcyjnej. To odpowiedni wariant do ewentualnego odrębnego hostingu testowego **po osobnym zatwierdzeniu publikacji**. Sam skrypt niczego nie wysyła. `noindex` nie ogranicza dostępu i nie gwarantuje tajności; paczka nie zawiera danych prywatnych.

## Paczka produkcyjna

```sh
npm run build:production
```

Wynik: `/workspace/exports/shadowbridge-v2-production`, poza repozytorium. Głównym plikiem `/index.html` jest zatwierdzony frontend V2. Paczka zawiera wyłącznie dwa pliki HTML (`/index.html`, `/cartel/index.html`), katalog `assets`, `robots.txt`, `sitemap.xml` i manifest integralności `.shadowbridge-build.json`. Nie kopiuje dawnych stron/paneli, zależności, testów, `.git`, workflow ani pliku `CNAME`. Wymaga zwykłego hostingu statycznego z obsługą `index.html` w katalogach; nie skonfigurowano żadnego dostawcy.

Źródła pozostają podglądem z `noindex, nofollow`. Dopiero paczka produkcyjna otrzymuje na homepage `index, follow`, canonical i `og:url` `https://shadow-bridge.eu/`; elementy oznaczone `data-preview-only` są pomijane. Strona informacyjna Cartel zachowuje `noindex, nofollow` oraz otrzymuje canonical i `og:url` `https://shadow-bridge.eu/cartel/`. Mapa zawiera tylko homepage, a robots wyklucza `/cartel/`. To reguły indeksowania, nie autoryzacja. Strona Cartel nie zawiera chronionych danych ani działającego logowania.

**Nie używaj paczki produkcyjnej do tymczasowego podglądu internetowego.** Nie skonfigurowano hostingu, dodatkowych nagłówków, płatnych usług ani API. Publikacja wymaga osobnej zgody.

## Własny katalog, również na Linuxie właściciela

Katalog `/workspace` jest domyślną ścieżką środowiska Codex. Na własnym komputerze wybierz nowy, dedykowany katalog poza checkoutem:

```sh
npm run build:preview -- --out /tmp/shadowbridge-v2-preview
npm run build:production -- --out /tmp/shadowbridge-v2-production
```

Istniejący katalog wynikowy zostanie zastąpiony tylko wtedy, gdy ma rozpoznany manifest własności właściwego trybu, wszystkie pliki są objęte jego wykazem i ich SHA256 odpowiada poprzedniemu eksportowi. Obcy, zmodyfikowany lub niekompletny wynik zatrzymuje budowanie. W takim przypadku wskaż inny nowy katalog. Nigdy nie kieruj komendy na katalog opublikowanej strony. Tryby preview i production wymagają osobnych katalogów.

Aby otworzyć paczkę lokalnie na swoim komputerze:

```sh
cd /tmp/shadowbridge-v2-preview
python3 -m http.server 8000 --bind 127.0.0.1
```

Otwórz `http://127.0.0.1:8000/` w swojej przeglądarce. Zatrzymanie: Ctrl+C. To lokalny serwer na Twoim komputerze, bez publikacji internetowej.

## Samowystarczalny podgląd do pobrania

W `v2` uruchom:

```sh
npm run export:review
```

Skrypt aktualizuje `review/ShadowBridge-V2.html`, `review/cartel/index.html`, licencje fontów, instrukcję, robots i manifest źródeł. Osadza wszystkie trzy lokalne fonty, grafiki SVG i arkusze CSS. Główna strona zawiera również wspólny moduł treści i aplikację jako zwykły skrypt, aby działać przy otwarciu pliku z dysku. Link Cartel prowadzi do wyeksportowanej strony informacyjnej, a jej link powrotny do głównego pliku podglądu.

Otwórz główny HTML bezpośrednio w przeglądarce albo uruchom powyższy serwer Python w katalogu `review` i otwórz `http://127.0.0.1:8000/ShadowBridge-V2.html`. Obie strony zachowują `noindex, nofollow`. CSP eksportu blokuje połączenia API/sieciowe (`connect-src 'none'`). Akcja mailto otwiera lokalnie skonfigurowaną aplikację pocztową: użytkownik sam decyduje o wysłaniu wiadomości. Nie korzysta to z backendu i nie rejestruje konta. Działanie schowka i aplikacji pocztowej zależy od przeglądarki/systemu. Dostępne jest pobranie briefu.

Eksporter nie usuwa ani nie regeneruje zrzutów. Po ostatecznych zmianach wyglądu odśwież `review/desktop.png` i `review/mobile.png` osobnym testem przeglądarkowym.

## Pochodzenie i granice weryfikacji

Manifesty zapisują SHA256 dokładnych źródeł i plików wynikowych, `baseCommit` i `workingTreeExport`. Commit bazowy nie jest przedstawiany jako zawierający niezacommitowane zmiany. Po zmianie źródeł uruchom eksport ponownie i sprawdź obie paczki w przeglądarce. Skrypty zachowują źródłowy HTML, aplikację, stare strony oraz referencje Git. Udane budowanie potwierdza powstanie paczki; testy przeglądarkowe i decyzja o publikacji są osobnymi krokami.
