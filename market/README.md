# ShadowBridge Market — M1

Osobny, lokalny prototyp publicznej giełdy B2B. **Nie jest wersją International ani działającą usługą handlową.** 18 fikcyjnych ofert, 6 fikcyjnych dostawców, 5 krajów demonstracyjnych. Wszystkie obrazy produktów to własne ilustracje SVG, nie zdjęcia rzeczywistych towarów.

## Podgląd na Pop!_OS

1. Pobierz ZIP gałęzi [feature/shadowbridge-market-m1](https://github.com/Thomas-Thor/ShadowBridge/tree/feature/shadowbridge-market-m1): **Code → Download ZIP**. Rozpakuj do nowego katalogu, obok dotychczasowej instalacji. Nie zastępuj jej plików.
2. W menedżerze plików otwórz rozpakowany główny katalog repozytorium, następnie **Otwórz w terminalu**. Wykonaj jedno polecenie:

   ```sh
   npm --prefix market run dev
   ```

3. Otwórz **http://127.0.0.1:4175** w przeglądarce tego samego komputera. Zakończenie: **Ctrl+C** w tym terminalu.

Potrzebny jest Node.js ≥22.12 (zalecany 24). **Bez `npm install`, Dockera, bazy, haseł i `.env`.** Nie uruchamiaj `npm run demo` ani instalatora produkcyjnego. Adres localhost tego środowiska Codex nie jest adresem dostępnym na komputerze właściciela — powyższe polecenie trzeba uruchomić lokalnie. To nie jest podgląd internetowy.

Jeśli port jest zajęty: `MARKET_PORT=4176 npm --prefix market run dev`, potem http://127.0.0.1:4176. Serwer zawsze słucha wyłącznie na `127.0.0.1`. Nie otwieraj `index.html` przez `file://`; moduły i taksonomia wymagają lokalnego HTTP.

## Cztery widoki

| Widok | Adres lokalny |
| --- | --- |
| Strona główna | http://127.0.0.1:4175/ |
| Katalog, wyszukiwanie i filtry | http://127.0.0.1:4175/offers/ |
| Szczegóły przykładowej oferty | http://127.0.0.1:4175/offers/DEMO-MKT-001/ |
| Profil przykładowego dostawcy | http://127.0.0.1:4175/suppliers/demo-morava/ |

Wyszukaj `oats`, sprawdź kategorię, kraj, typ i PLN; przejdź na drugą stronę katalogu. Kliknij ofertę, dostawcę i **Enquire · demo only**. Przycisk pokazuje wyłącznie informację — niczego nie wysyła ani nie zapisuje.

## Zakres

Działa: nawigacja, wyszukiwanie, filtry, podkategorie, liczniki, sortowanie, paginacja, szczegóły, profile, mobilne menu i demonstracyjny dialog. Nie działa celowo: rejestracja, logowanie Market, publikowanie, prawdziwe zapytania, płatności, wiadomości, przesyłanie zdjęć. Brak deklaracji cen abonamentów, weryfikacji firm lub rzeczywistych stanów magazynowych.

Dokumenty: [architektura](docs/ARCHITECTURE.md), [mapowanie kategorii](docs/CATEGORIES.md), [wyniki testów](docs/TEST-REPORT.md).

## Kontrole lokalne

`npm --prefix market test` — 8 testów logiki, klasyfikacji i lokalnego serwera, bez dodatkowych zależności.

Testy przeglądarkowe korzystają z **już zainstalowanych** `@playwright/test`, `@axe-core/playwright` i Chromium; instrukcja w raporcie. Nie są potrzebne do zwykłego oglądania prototypu.
