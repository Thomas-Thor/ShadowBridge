# ShadowBridge V2 — podgląd i przygotowanie publikacji

Publiczny frontend w języku angielskim, odizolowany w `v2/`. Nie zastępuje obecnej strony głównej. Nie wdrożono go na `shadow-bridge.eu`, nie zmieniono DNS ani ustawień GitHub Pages. Gałąź robocza: `feature/shadowbridge-v2`.

## Podgląd

Z katalogu głównego repozytorium:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

W lokalnej przeglądarce otwórz ścieżkę `/v2/` na porcie 8000. Serwer musi udostępniać katalog repozytorium, aby równolegle można było przeglądać zachowane strony legacy. Zatrzymanie: `Ctrl+C`.

Nie jest potrzebny build, instalowanie zależności ani zewnętrzne API. Moduły JavaScript wymagają serwera HTTP — otwarcie pliku HTML bezpośrednio z dysku nie zapewni pełnej obsługi formularza. Cały frontend, fonty i grafiki są lokalne.

## Działający zakres

- Osiem sekcji: hero, firma, usługi, branże, proces współpracy, globalny network, ścieżki współpracy oraz kontakt.
- Układ desktop/tablet/mobile, menu z obsługą klawiatury i Escape, pominięcie nawigacji, dostępne zakładki branż oraz ograniczenie animacji przy `prefers-reduced-motion`.
- Ścieżki buyer/supplier/agent wybierają odpowiednią rolę zapytania. Wybrana branża może zostać dołączona do briefu.
- Walidacja formularza, pobranie rzeczywistego pliku `.txt` i kopiowanie briefu do schowka z obsługą odmowy uprawnień.
- Potwierdzony publiczny kontakt `shadowbridge.trade@gmail.com` jest klikalny i widoczny także bez JavaScript. „Prepare email” tworzy wiadomość `mailto` zawierającą dane formularza, rolę i wybraną branżę. Użytkownik musi ją sprawdzić i sam wysłać w swoim programie pocztowym; witryna nie potwierdza dostarczenia.
- Długie briefy nie są obcinane. Gdy zakodowany link przekracza ostrożny limit 2000 znaków, interfejs wskazuje pobranie lub skopiowanie pełnej treści i wysłanie jej przez własny program pocztowy.
- Zapytania nie są wysyłane przez serwer strony, zapisywane w bazie ani utrwalane w `localStorage`. Bez JavaScript treści, nawigacja i bezpośredni e-mail pozostają dostępne; generowanie briefu jest wyłączone.
- Dyskretny link w stopce prowadzi do osobnej strony `cartel/` z informacją o sieci dostępnej wyłącznie na zaproszenie. Nie ma tam logowania, formularza rejestracji, danych członków ani kontroli dostępu opartej na parametrach URL.

## Brakujące dane i zależności

Właściciel potwierdził publiczny e-mail `shadowbridge.trade@gmail.com`. Nie dodano niepotwierdzonego telefonu, adresu, numerów rejestrowych ani nazwy osoby prawnej. `assets/content.en.js` zawiera tylko publiczną konfigurację. Obsługa `mailto` zależy od programu pocztowego i konfiguracji przeglądarki użytkownika; pobieranie i kopiowanie briefu pozostają alternatywą. Działanie linku nie jest potwierdzeniem dostarczenia wiadomości ani weryfikacją skrzynki odbiorczej.

Rejestracja kont, logowanie, odzyskiwanie hasła, e-mail weryfikacyjny, uprawnienia i rzeczywiste dane paneli nie są wdrożone. Propozycja następnego etapu: [architektura rejestracji i hostingu](../docs/shadowbridge-v2-architecture.md).

## Struktura i utrzymanie

```text
v2/
  index.html                 treść, semantyka, metadane, statyczne SEO
  cartel/index.html          strona informacyjna sieci na zaproszenie
  assets/styles.css          lokalne fonty, tokeny, komponenty, breakpointy
  assets/app.js              menu, zakładki, role i lokalny eksport briefu
  assets/content.en.js       publiczna konfiguracja i dynamiczne teksty EN
  assets/bridge-mark.svg     oryginalny znak do przyszłej sygnatury/pieczęci
  assets/global-bridge.svg   oryginalna ilustracja hero
  assets/cartel.css          wygląd strony C.A.R.T.E.L. Division
  assets/fonts/              WOFF2, licencje OFL i źródła z integrity
  tests/                     Playwright i axe
  scripts/                   lokalne przygotowanie paczek i eksportu podglądu
```

Dla przyszłych języków utworzyć osobne, semantyczne wejścia HTML i moduły treści, poprawne `lang`, tytuły oraz po publikacji canonical/hreflang. Nie pobierać prywatnej konfiguracji z publicznego modułu treści. Integracje CRM i klucze API należą wyłącznie do przyszłego backendu.

Źródłowy podgląd i eksport `review` zachowują `noindex, nofollow`. `npm --prefix v2 run build:production` przygotowuje odrębny katalog poza checkoutem: zatwierdzony V2 jako `/index.html`, stronę `/cartel/`, zasoby, canonical `https://shadow-bridge.eu/`, produkcyjne indeksowanie homepage oraz robots/sitemap. Strona sieci prywatnej pozostaje nieindeksowana i informacyjna. Produkcja nie zawiera oznaczeń DESIGN PREVIEW, starych paneli, testów ani zależności narzędziowych. Skrypt niczego nie wdraża. Procedura, ograniczenia i parametry: [RELEASE-BUILD.md](RELEASE-BUILD.md); ustalenia hostingu i kroki wymagające osobnej zgody: [plan publikacji](../docs/shadowbridge-v2-release.md).

`npm --prefix v2 run export:review` odświeża oba samowystarczalne HTML w katalogu `review`. Na własnym Linuxie można rozpakować ZIP gałęzi i otworzyć `review/ShadowBridge-V2.html`; link w stopce otworzy `review/cartel/index.html`. Zachowaj cały katalog, aby działał powrót pomiędzy stronami.

Fonty Instrument Serif 5.3.0 i DM Sans Variable 5.3.0 pochodzą z Fontsource, mają licencję OFL-1.1. Archiwa sprawdzono względem SHA-512 z rejestru npm. Licencje i metadane są dołączone. Obie grafiki SVG przygotowano na potrzeby tego prototypu; nie korzystają ze stockowych obrazów.

## Testy

Node.js ≥22.12 i Python 3:

```sh
npm --prefix v2 ci --ignore-scripts
npm --prefix v2 test
```

Szczegóły instalacji Chromium i zakres: [tests/README.md](tests/README.md). Wyniki i ograniczenia manualnego przeglądu: [raport implementacji](../docs/shadowbridge-v2-implementation.md).

## Zachowane panele

Formularze i panele legacy nadal istnieją. Jawne podglądy danych przykładowych:

- `/agent-registration.html?preview=1`
- `/clients/client-registration.html?preview=1`
- `/suppliers/supplier-registration.html?preview=1`

Parametr `preview=1` nie jest uwierzytelnieniem ani nadaniem uprawnień. Udostępnia wyłącznie zachowaną demonstrację statyczną. Stare symulacje rejestracji pozostały w kodzie za bezwarunkowymi bezpiecznymi zakończeniami; ich zastąpienie realną integracją będzie odrębnym etapem.
