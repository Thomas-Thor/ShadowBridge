# ShadowBridge V2 — poprawki końcowe i przygotowanie publikacji

Stan: 18.10.2026. Gałąź `feature/shadowbridge-v2`. Projekt wizualny, kolory, typografia i oba oryginalne SVG pozostają zachowane. Nie zmieniono `main`, starej strony głównej, formularzy/paneli legacy, DNS, domeny ani konfiguracji hostingu. Nie wdrożono strony i nie uruchomiono backendu/rejestracji.

## Zrealizowane poprawki

- Potwierdzony e-mail `shadowbridge.trade@gmail.com` jest widoczny i działa jako statyczny link mailto, także bez JavaScript.
- „Prepare email” waliduje pola i przygotowuje zakodowany draft z jednym stałym odbiorcą, tematem, nazwą, e-mailem, firmą, rolą, branżą i treścią. Wiadomość musi wysłać użytkownik w swoim kliencie. Strona nigdy nie potwierdza wysyłki lub doręczenia.
- „Download enquiry brief” oraz „Copy brief instead” pozostają pełnymi alternatywami. Nie obcina się długich zapytań: ponad 2000 znaków zakodowanego URL wskazywany jest pełny eksport/kopiowanie. Zmiana pól, branży lub roli unieważnia stary link draftu.
- Stopka ma nawigację i dyskretny link C.A.R.T.E.L. Division. Osobny `/cartel/` to responsywna strona informacyjna, z powrotem do ShadowBridge, bez kont, haseł, kodów, paneli i danych członków. Parametry URL nie przyznają dostępu.
- Podglądy zachowują noindex. Odrębna paczka produkcyjna ma V2 jako `/index.html`, canonical/og:url dla `https://shadow-bridge.eu/`, index/follow, sitemap i brak etykiet deweloperskich. Informacyjny `/cartel/` pozostaje noindex. Żadna paczka nie publikuje się automatycznie.
- Przyszłe zaproszenia właściciela opisano jako serwerowe, indywidualne, jednorazowe, odwoływalne i powiązane z tożsamością. Nie implementowano ich w frontendzie.

## Wyniki walidacji

| Zakres | Wynik |
| --- | --- |
| 88 scenariuszy Playwright: 76 publicznych V2 i 12 legacy, szerokości1440/768/390/320px | Zaliczone; brak wyłączonych testów. |
| Nagłówek, stopka, wszystkie CTA, sekcje, role, e-mail, wejście/powrót Cartel | Kliknięcia i oczekiwane działania sprawdzone. |
| Mailto | Stały poprawny odbiorca, temat, pełne pola, Unicode i znaki specjalne sprawdzone; uruchomienie aplikacji przechwycone w teście, bez faktycznej wysyłki. |
| Długie zapytanie i aktualizacja draftu | Pełna treść w pobranym briefie; brak cichego obcięcia i brak użycia starego draftu po zmianach. |
| WCAG axe: homepage i Cartel we wszystkich czterech projektach | Zero naruszeń sprawdzanych reguł; nie jest to pełny certyfikat zgodności. |
| Brak JS, klawiatura, menu/Escape, zakładki i schowek z odmową uprawnień | Zaliczone; statyczny e-mail dostępny bez JS. |
| Źródłowe zasoby i konsola | Brak 404, błędów JS, niezamierzonych żądań API i przewijania poziomego. |
| Produkcja, preview i review ×1440/390px | 6 dodatkowych przepływów przeglądarkowych zaliczonych, w tym draft/pobranie/Cartel/powrót/metadane. |
| Granice breakpointów360/480/700/701/1000/1001/1024/1100/1200/1280/1600/1920px | Bez przewijania poziomego. |
| Build i eksport | Powtarzalne; SHA256 wszystkich źródeł i wyników zgodne; próby nadpisania obcych, zmienionych, niekompletnych lub symlinkowanych katalogów odrzucone. |

Sprawdzono Chromium. Nie testowano rzeczywistego doręczenia e-maila ani wszystkich konfiguracji klientów pocztowych. Zarządzana przeglądarka środowiska blokuje `file://`; eksport sprawdzono po lokalnym HTTP, bez obchodzenia tej polityki.

Komendy reprodukcji z katalogu repozytorium:

```sh
npm --prefix v2 ci --ignore-scripts
npm --prefix v2 test
npm --prefix v2 run build:production
npm --prefix v2 run build:preview
npm --prefix v2 run export:review
node v2/tests/check-exports.cjs
```

Narzędzia testowe wymagają Node>=22.12, Pythona3 i Chromium. Sam podgląd pobrany przez właściciela nie wymaga npm ani Node.

## Podgląd na Linuxie właściciela

1. Pobrać ZIP gałęzi `feature/shadowbridge-v2` i rozpakować cały katalog.
2. Otworzyć `review/ShadowBridge-V2.html` w Firefox/Chrome; link w stopce prowadzi do `review/cartel/index.html`.
3. Zachować cały folder `review`, w tym powrotną nawigację i licencje fontów. Zrzuty czterech widoków znajdują się w plikach PNG w tym katalogu.
4. Jeżeli lokalny HTML jest blokowany: terminal w `review`, komenda `python3 -m http.server 8000 --bind 127.0.0.1`, potem adres `http://127.0.0.1:8000/ShadowBridge-V2.html` we własnej przeglądarce. Ctrl+C kończy serwer.
5. „Prepare email” otwiera skonfigurowany program pocztowy. W nim należy samodzielnie nacisnąć Wyślij; brak klienta pocztowego nie oznacza wysłania. Dostępne są kopiowanie i pobranie briefu.

## Publikacja — nadal do potwierdzenia

[Ustalenia hostingu i dokładna procedura](shadowbridge-v2-release.md) oddzielają potwierdzenie właściciela od mojego odczytu technicznego. Właściciel sprawdził Settings→Pages: GitHub Pages, „Deploy from a branch”, `main`, `/` (root), domena `shadow-bridge.eu`, DNS check Successful, Enforce HTTPS włączone, witryna Live. Rejestratorem domeny jest Porkbun; termin wygaśnięcia pozostaje nieznany. Nie utożsamia się rejestratora z operatorem autorytatywnego DNS. Proxy/resolver nadal uniemożliwia niezależny test produkcyjnego HTTP, TLS i rekordów DNS.

Samo scalenie gałęzi nie zastąpi obecnego root homepage przez `v2/index.html`. Zalecana publikacja gotowej paczki V2 na zatwierdzonym nowym hostingu nie wymaga merge: jej `/index.html` jest właściwą stroną główną. Stare pliki na `main` pozostają zachowane w Git i jako punkt wycofania. Przełączenie istniejącej domeny wymaga oddzielnego, jawnego planu DNS i HTTPS, opisanego w dokumencie publikacji.

Jeżeli aktualnie działa GitHub Pages, jego oficjalne ograniczenia biznesu online wymagają uwzględnienia. Rekomendacja do odrębnego zatwierdzenia: komercyjny hosting statyczny, np. Cloudflare Pages Direct Upload. Nie założono konta, nie wybrano płatnego planu, nie uruchomiono projektu ani migracji.

Zalecana kolejność: potwierdzenie obecnego hostingu i drogi wycofania → zatwierdzenie docelowego dostawcy i domeny → osobno zatwierdzony, nieindeksowany podgląd → test HTTPS/zasobów/mailto → zatwierdzenie konkretnej paczki produkcyjnej i zmiany DNS, jeśli konieczna → dopiero autoryzowane przełączenie. Na hosting wgrywa się zawartość wyniku `build:production`, a nie całe repozytorium, `review` ani starą stronę root. Dzięki temu wejściem będzie zatwierdzony V2, a stare panele nie zostaną wystawione jako działająca platforma.

Ograniczenia dla odwiedzających są jawne: wysyłka w kliencie pocztowym, brak kont/rejestracji/portalu członkowskiego. Nie dodano niepotwierdzonego telefonu, adresu, danych rejestrowych, referencji ani statystyk.

## Dokładne pliki dodane lub zmienione względem d0ac38a

- `docs/shadowbridge-v2-final-corrections.md`
- `docs/shadowbridge-v2-implementation.md`
- `docs/shadowbridge-v2-release.md`
- `review/FONT-LICENSES.txt`
- `review/README-PL.md`
- `review/SOURCE-MANIFEST.json`
- `review/ShadowBridge-V2.html`
- `review/cartel-desktop.png`
- `review/cartel-mobile.png`
- `review/cartel/index.html`
- `review/desktop.png`
- `review/mobile.png`
- `review/robots.txt`
- `review/verification.json`
- `v2/README.md`
- `v2/RELEASE-BUILD.md`
- `v2/assets/app.js`
- `v2/assets/cartel.css`
- `v2/assets/content.en.js`
- `v2/assets/styles.css`
- `v2/cartel/index.html`
- `v2/index.html`
- `v2/package.json`
- `v2/scripts/build-production.mjs`
- `v2/scripts/export-review.mjs`
- `v2/scripts/release-utils.mjs`
- `v2/tests/README.md`
- `v2/tests/check-exports.cjs`
- `v2/tests/public-site.spec.cjs`
