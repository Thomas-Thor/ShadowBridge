# ShadowBridge — private B2B frontend review

Gałąź: `feature/private-b2b-entrypoints`, utworzona z produkcyjnego commita
`d0512dd37a162744d845a5cf32ddc25ac3d4f633`. **Ta praca nie jest wdrożeniem.**
Nie zmieniono gałęzi `main`, domeny, DNS ani konfiguracji hostingu.

## Co można przejrzeć

- `/` — zaakceptowana strona V2 z dodatkowymi wejściami w istniejących kartach
  Buyer, Supplier i B2B Partner. Poprzednie linki kontaktowe są zachowane.
- `/apply/buyer/`, `/apply/supplier/`, `/apply/partner/` — oddzielne strony
  zgłoszeniowe; wszystkie pola i wysyłanie pozostają nieaktywne także bez JS.
- `/member-sign-in/` — wspólne wejście logowania, jawnie nieaktywne.
- `/prototypes/` — osobny przegląd trzech paneli, wyłącznie fikcyjne dane.
  Przyciski wyświetlają/zerują stały szablon demonstracyjny, a filtry pokazują
  przykładowe własne rekordy. Nie ma zapisu, wysyłania, uploadu ani sesji.
- `/cartel/` — istniejąca strona informacyjna zachowana bez zmian.

Nie ma katalogu firm, automatycznej rejestracji, kojarzenia kontrahentów ani
dostępu do danych prywatnych. Nowe interfejsy nie zbierają danych osobowych ani
rzeczywistych zgłoszeń. Istniejący formularz kontaktowy nadal przygotowuje
wiadomość do przeglądu i wysłania przez własny program pocztowy użytkownika.

## Podgląd na własnym komputerze z Linuxem

Do samego podglądu wystarczy Python 3, bez Node i bez instalowania zależności.

1. Pobierz dostarczone archiwum `ShadowBridge-private-b2b-review.zip` i rozpakuj je.
2. W terminalu przejdź do rozpakowanego katalogu `ShadowBridge-private-b2b`.
3. Uruchom:

   ```bash
   python3 -m http.server 8080 --bind 127.0.0.1
   ```

4. Na **tym samym komputerze** otwórz `http://127.0.0.1:8080/` i następnie
   `http://127.0.0.1:8080/prototypes/`. Są to adresy lokalnego podglądu na Twoim
   komputerze, a nie linki do środowiska Codex. Użyj portu 8081, jeśli 8080 jest zajęty.
5. Przetestuj trzy wejścia, Member Sign In, rozwijane listy kontrolne,
   fikcyjne szablony i filtry paneli oraz powrót z C.A.R.T.E.L.
   W kontakcie wystarczy użyć fikcyjnego briefu i nie wysyłać wiadomości.
6. Zatrzymaj serwer przez `Ctrl+C`. Nie publikuj tego archiwum jako produkcji.

Nie otwieraj strony przez samo dwukrotne kliknięcie HTML: istniejący moduł
kontaktu wymaga HTTP. Żaden prawdziwy system rejestracji nie działa w podglądzie.
Serwer jest ograniczony do loopback i nie udostępnia plików w Twojej sieci.

## Oddzielna paczka publicznego podglądu

Node 22+ wystarczy do zbudowania paczki; nie ma nowych zależności:

```bash
node scripts/build-preview.mjs --out /tmp/shadowbridge-public-preview
```

Wybierz nowy katalog wyjściowy, jeśli istnieje — skrypt nie nadpisuje wcześniejszych
plików. Paczka ma zamkniętą listę publicznych plików, `noindex, nofollow` i
`robots.txt: Disallow: /`. Wyklucza prototypy oraz ich CSS/JS, dokumentację,
testy, skrypty, `.git`, `CNAME` i sitemapę. Dyrektywy robotów nie zapewniają
poufności; w paczce nie ma danych prywatnych. Nie jest to paczka do automatycznego
zastąpienia produkcji. Nie konfigurowano żadnego wdrożenia.

## Testy

W przygotowanym środowisku używamy już obecnych Playwright/axe i Chromium,
bez instalowania dodatkowych paczek. Instrukcja i zakres: [tests/README.md](tests/README.md).
Sprawdzamy nowe przepływy, wąski ekran, dostępność oraz reprezentatywny kontakt
i C.A.R.T.E.L.; nie uruchamiamy ponownie wszystkich historycznych testów repozytorium.

## Architektura i koszty

[docs/architecture.md](docs/architecture.md) opisuje uprawnienia, model bazy,
anonimowe karty, autoryzację serwerową, kwarantannę i anonimizację dokumentów,
historię przedstawień, umowy prowizyjne i kontrolowane ujawnianie tożsamości.
Pełne tożsamości i wewnętrzne powiązania pozostają wyłącznie po stronie backendu.

Rekomendacja: PostgreSQL/Auth/prywatny Storage + API/BFF (np. Supabase),
e-mail transakcyjny i osobny proces skanowania dokumentów. Wstępny budżet
małego wdrożenia: **35–85 USD/mies.**; aktualnych cenników nie udało się
potwierdzić przez proxy, więc przed zakupem wymagają ponownego sprawdzenia.
Nie uruchomiono usług i nie poniesiono opłat. Backend, Command Center,
C.A.R.T.E.L. Private Division i produkcyjne wdrożenie wymagają osobnej akceptacji.
