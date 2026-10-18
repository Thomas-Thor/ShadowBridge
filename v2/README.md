# ShadowBridge V2 — lokalny prototyp

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
- Żadne zapytanie nie jest wysyłane, zapisywane w bazie ani utrwalane w `localStorage`. Pobrany lub skopiowany dokument zawiera wyraźną informację, że nie został wysłany.
- Bez JavaScript treści i nawigacja pozostają dostępne, a przyciski eksportu są wyłączone. Formularz nie udaje wysyłki.

## Brakujące dane i zależności

Właściciel musi potwierdzić publiczny adres e-mail i ewentualne dane prawne firmy. Nie wymyślano danych kontaktowych. Do tego czasu strona uczciwie opisuje brak potwierdzonego kanału kontaktu. `assets/content.en.js` zawiera tylko publiczną konfigurację; wpisanie zatwierdzonego adresu pokaże link `mailto`, bez automatycznej wysyłki.

Rejestracja kont, logowanie, odzyskiwanie hasła, e-mail weryfikacyjny, uprawnienia i rzeczywiste dane paneli nie są wdrożone. Propozycja następnego etapu: [architektura rejestracji i hostingu](../docs/shadowbridge-v2-architecture.md).

## Struktura i utrzymanie

```text
v2/
  index.html                 treść, semantyka, metadane, statyczne SEO
  assets/styles.css          lokalne fonty, tokeny, komponenty, breakpointy
  assets/app.js              menu, zakładki, role i lokalny eksport briefu
  assets/content.en.js       publiczna konfiguracja i dynamiczne teksty EN
  assets/bridge-mark.svg     oryginalny znak do przyszłej sygnatury/pieczęci
  assets/global-bridge.svg   oryginalna ilustracja hero
  assets/fonts/              WOFF2, licencje OFL i źródła z integrity
  tests/                     Playwright i axe
```

Dla przyszłych języków utworzyć osobne, semantyczne wejścia HTML i moduły treści, poprawne `lang`, tytuły oraz po publikacji canonical/hreflang. Nie pobierać prywatnej konfiguracji z publicznego modułu treści. Integracje CRM i klucze API należą wyłącznie do przyszłego backendu.

Prototyp ma celowo `noindex, nofollow`. Usunięcie tej dyrektywy, ustawienie produkcyjnego canonical, formularza kontaktowego, polityk prywatności i publikacja wymagają osobnego etapu oraz akceptacji. Pliki `package.json`, testy i `node_modules` służą wyłącznie lokalnym narzędziom, nie są artefaktami produkcyjnymi.

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
