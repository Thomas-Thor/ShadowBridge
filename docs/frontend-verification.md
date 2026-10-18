# Weryfikacja obecnego frontendu

Data: 18 października 2026. Bazowa produkcja: `d0512dd`.
Gałąź robocza: `feature/private-b2b-entrypoints`.

## Wynik

Dziesięć celowanych scenariuszy przy 1440, 390 i 320 px zostało zaliczonych.
Nie uruchamiano historycznych pełnych zestawów testów. Po korekcie asercji
Playwright dotyczącej `fieldset` ponowiono tylko trzy dotknięte przypadki;
rzeczywiste pola nadal sprawdzane są osobno jako nieaktywne.

- Trzy wejścia na stronie głównej, strony ról, wspólne logowanie i powroty.
- Nieaktywne pola i wysyłanie także bez JavaScriptu; brak nowych POST, fetch/XHR,
  cookies, localStorage i sessionStorage w nowych przepływach.
- Rozwijane listy kontrolne i odzyskiwanie konta jako informacja obsługiwane klawiaturą.
- Jawne fikcyjne dane, szablony demonstracyjne, czyszczenie i filtry paneli;
  brak możliwości wpisania prawdziwej oferty albo wybrania pliku.
- Brak błędów zasobów i poziomego przewijania; automatyczne axe WCAG A/AA
  dla ośmiu nowych widoków. Nie jest to pełna certyfikacja dostępności.
- Zachowana ścieżka kontaktowa Buyer: wybór roli i przygotowanie właściwej
  wiadomości `mailto:shadowbridge.trade@gmail.com` bez jej wysyłania.
- Istniejący przycisk C.A.R.T.E.L., komunikat ograniczonego dostępu i powrót.

Po zastąpieniu niedostępnego w foncie znaku strzałki ikoną SVG ponowiono
trzy testy dostępności. Końcową paczkę publicznego podglądu sprawdzono osobno
na desktopie i przy 320 px, przechodząc przez wszystkie trzy wejścia i logowanie.
Przejrzano rzeczywiste zrzuty Chromium zapisane w `review/`.

## Ochrona zakresu publikacji

Paczka budowana przez `scripts/build-preview.mjs` zawiera 21 plików z zamkniętej
listy. Każda strona ma `noindex, nofollow`, a robots wyklucza całość. Nie ma
prototypów ani ich CSS/JS, dokumentacji, testów, skryptów, `.git`, `CNAME`
ani sitemapy. Skrypt nie nadpisuje istniejących katalogów i niczego nie wysyła.
Roboty nie są mechanizmem kontroli dostępu; paczka nie zawiera danych poufnych.

Źródłowe `CNAME`, strona `/cartel/`, jej CSS, dotychczasowe style i skrypty
strony, znaki marki, robots oraz sitemapę porównano bajt po bajcie z `d0512dd`.
Zmiany istniejącego HTML strony głównej ograniczają się do dołączenia nowego
arkusza i uzupełnienia kart współpracy; stare linki kontaktowe pozostają.

## Czego ten wynik nie oznacza

Nie ma uwierzytelniania, sesji, RLS, bazy, API, uploadu, analizy dokumentów
ani faktycznego systemu uprawnień. Nie przeprowadzono testów działającego backendu.
Fikcyjne dane nie są tajemnicą, a filtry i przełączanie projektów pokazują wyłącznie
zachowanie makiet. Przed przyjęciem prawdziwych danych potrzebna jest osobna
implementacja i testy autoryzacji opisane w `architecture.md`.

Nie wdrożono tej gałęzi, nie zmieniono produkcji, DNS ani hostingu i nie
uruchomiono płatnych usług. Prototypy oraz archiwum źródłowe służą recenzji lokalnej.
