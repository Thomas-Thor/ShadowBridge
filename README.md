# ShadowBridge — secure private B2B MVP

Gałąź: `feature/secure-b2b-mvp`, oparta na `feature/private-b2b-entrypoints`
(`2cc4de8`), zachowująca produkcyjny `main` (`d0512dd`). **Nie wdrożono tej
wersji na shadow-bridge.eu.** Nie zmieniono DNS, GitHub Pages ani treści strony `/cartel/`.

## Rzeczywisty lokalny backend

Wymagania: Linux, Docker + Compose v2, Node.js 22.12+ i npm.
W katalogu rozpakowanego repozytorium:

```bash
npm ci
npm run dev:up
npm run dev:server
```

Na **tym samym komputerze** otwórz `http://127.0.0.1:8088/`, a testowe wiadomości
w `http://127.0.0.1:8025/`. Nie są to publiczne linki do środowiska Codex.
Używaj fikcyjnych firm i losowych, osobnych haseł. Cała poczta trafia do lokalnego
Mailpit, nigdy do rzeczywistych odbiorców. Pierwszy start generuje sekrety poza
Git i pobiera przypięte obrazy PostgreSQL, Supabase GoTrue oraz Mailpit.

Rejestracja → prawdziwe potwierdzenie e-maila → oczekująca aplikacja firmy →
ręczna decyzja zarządu. Nie ma automatycznego dostępu do ofert. Link potwierdzający
najlepiej otworzyć w tym samym profilu przeglądarki. W innym profilu zaloguj się
po potwierdzeniu i uzupełnij aplikację w portalu. Anonimowa odpowiedź GoTrue na
rejestrację nigdy nie służy jako dowód tożsamości do zapisu danych firmy.

Po rejestracji i potwierdzeniu własnego fikcyjnego konta właściciela:

```bash
npm run bootstrap:admin -- --email=owner-test@shadowbridge.invalid --grant-management
```

Zaloguj się ponownie, przejdź do Command Center i skonfiguruj prawdziwy TOTP
w aplikacji uwierzytelniającej. Bez MFA nie można odczytywać ani zmieniać danych
administracyjnych. Nie istnieje wspólne hasło demo ani automatycznie aktywny admin.

Zarejestruj następnie Buyer, Supplier i B2B Partner, potwierdź ich e-maile w
Mailpit i zatwierdź firmy jako administrator. Utwórz ofertę dostawcy oraz RFQ
kupującego; prześlij je do oceny. Zatwierdź ofertę, przygotuj osobną nieidentyfikującą
kartę i przydziel ją konkretnemu kupującemu. Zweryfikuj brak dostępu z innego konta.
Partner może zgłaszać propozycje i widzieć przydzielone projekty oraz rzeczywiście
uzgodnione prowizje. Wszystkie zapytania przechodzą przez ShadowBridge.

Ctrl+C zatrzymuje BFF. `npm run dev:down` zatrzymuje kontenery **z zachowaniem
wolumenu bazy**. Wolumen nie jest kopią zapasową.

## Ochrona danych i granice MVP

- Autoryzacja API i wymuszone RLS po stronie PostgreSQL; oddzielne role bazy.
- Opaque HttpOnly sessions; JWT/refresh token zaszyfrowane na serwerze, bez localStorage.
- Źródłowe oferty i pełne tożsamości są osobne od anonimowych kart i przydziałów.
- Wątki wiadomości izolowane per firma, również przy tej samej anonimowej karcie.
- Zawieszenie natychmiast blokuje biznesowe API; decyzje i ważne zdarzenia mają audyt.
- Dokumenty nie są przesyłane. Przed prawdziwymi plikami wymagane są prywatny storage,
  kwarantanna, antymalware, OCR/redakcja i ręczna akceptacja. Detekcja tekstu nie
  gwarantuje usunięcia wszystkich identyfikatorów.
- C.A.R.T.E.L. pozostaje stroną informacyjną; nie ma prywatnego logowania tej dywizji.

Szczegóły: [uruchomienie i konfiguracja](docs/mvp-operations.md),
[raport weryfikacji](docs/mvp-verification.md),
[architektura docelowa](docs/architecture.md).

## Testy i paczka publiczna

```bash
npm run test:api
node --test server/tests/config.security.test.mjs
```

Przeglądarkowe testy korzystają z istniejącego Playwright; instrukcja w
[server/tests/README.md](server/tests/README.md). Nie zawierają haseł testowych
ani połączenia z prawdziwym CRM. Wcześniejsze makiety zachowano w `prototypes/`.

`node scripts/build-preview.mjs --out /absolute/new-directory` buduje wyłącznie
statyczny, nieindeksowany podgląd publiczny. Wyklucza backend, portal, account.js,
sekrety, bazę, testy i makiety. Formularze kont pozostają w nim nieaktywne.
**Nigdy nie uploaduj całego repozytorium jako publicznej witryny.**

Nie skonfigurowano zewnętrznego Supabase, rzeczywistego SMTP ani hostingu BFF.
GitHub Pages nie uruchomi tego backendu. Każde wdrożenie, usługi płatne i
użycie prawdziwych danych wymagają osobnego zatwierdzenia; budżet wstępny
małego środowiska to orientacyjnie 35–85 USD/mies., przed zakupem należy
potwierdzić aktualne cenniki i zakres backupów.

Przycisk WhatsApp używa numeru przekazanego przez właściciela. Link wa.me z
samej swojej konstrukcji ujawnia numer docelowy; nie pokazujemy go jako osobnego
tekstu na stronie i nie wysyłamy automatycznych wiadomości. Brak weryfikacji
w tym środowisku, czy numer jest aktywnym kontem WhatsApp Business.
