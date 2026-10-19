# ShadowBridge — secure private B2B MVP

**Punkt kontrolny, publikacja wstrzymana.** Zachowany rozwój po `a4582db` i jego
ograniczenia opisano w [raporcie zabezpieczenia pracy](docs/checkpoint-2026-10-19.md).
To nie jest potwierdzenie gotowości całej platformy do wydania. Poniższa instrukcja
uruchomienia pochodzi z poprzedniego etapu; nowy launcher wymaga końcowej weryfikacji.

Gałąź: `feature/secure-b2b-mvp`, oparta na `feature/private-b2b-entrypoints`
(`2cc4de8`), zachowująca produkcyjny `main` (`d0512dd`). **Nie wdrożono tej
wersji na shadow-bridge.eu.** Nie zmieniono DNS, GitHub Pages ani treści strony `/cartel/`.

## Rzeczywisty lokalny backend

Wymagania: Linux, Docker + Compose v2, Node.js 22.12+ i npm.
W katalogu rozpakowanego repozytorium:

```bash
npm ci
npm run demo
```

Po komunikacie **MVP gotowy** otwórz na swoim komputerze
<http://127.0.0.1:8088/member-sign-in/>. W drugim terminalu, w tym samym
katalogu, wykonaj `npm run demo:accounts`, aby zobaczyć losowo wygenerowane
loginy i hasła Buyer, Supplier, Partner i Owner. Dla Owner użyj
`npm run demo:code` i wpisz kod MFA w Command Center. Nie edytujesz plików
konfiguracyjnych. Nie ma wspólnego hasła ani sekretów w Git.

Demo wykonuje prawdziwą rejestrację i potwierdzenie adresów w lokalnym Auth,
MFA i zatwierdzenie fikcyjnych firm przez API. Tworzy testową ofertę, RFQ,
indywidualnie przydzieloną anonimową okazję i projekt Partnera. Normalne
zgłoszenia wymagają osobnej decyzji administratora.

Poczta testowa: <http://127.0.0.1:8025/>. Nie jest wysyłana do Gmaila.
Formularz kontaktowy zapisuje wiadomość do prywatnej kolejki administratora
w PostgreSQL; potwierdzeniem jest numer `SB-CONTACT-*`. Odczyt i statusy
wymagają konta zarządu z MFA; formularz nie wysyła e-maila.

[Krótka instrukcja Pop!_OS](docs/POP-OS.md) opisuje wymagania, ręczne testy
nowych rejestracji i zatrzymanie. Ctrl+C zatrzymuje aplikację;
`npm run dev:down` zatrzymuje kontenery, zachowując bazę. Następny start:
`npm run demo`. Powyższe adresy działają lokalnie po uruchomieniu na Twoim
komputerze, nie udostępniają środowiska Codex.

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
npm run test:contact
node --test server/tests/config.security.test.mjs
```

Przeglądarkowe testy korzystają z istniejącego Playwright; instrukcja w
[server/tests/README.md](server/tests/README.md). Nie zawierają haseł testowych
ani połączenia z prawdziwym CRM. Wcześniejsze makiety zachowano w `prototypes/`.

`node scripts/build-preview.mjs --out /absolute/new-directory` buduje wyłącznie
statyczny, nieindeksowany podgląd publiczny. Wyklucza backend, portal, account.js,
sekrety, bazę, testy i makiety. Formularze kont i kontaktu pozostają w nim nieaktywne.
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

Sekcja [Legal Information](legal/index.html) zachowuje formalny adres e-mail
właściciela i wskazuje operatora THØR NORDIC COMMERCE V/ TROJANOWSKI,
934 957 296, ENK, Norway. SHADOWBRIDGE jest jego marką handlową.
`assets/legal-information.js` umożliwia przypisanie kolejnych marek do tego samego
operatora. Adres rejestrowy nie jest częścią kodu publicznego ani paczki; jego
publikacja oczekuje osobnego zatwierdzenia. Nie dodano numeru VAT/MVA.
Przed publicznym uruchomieniem platformy trzeba potwierdzić komplet wymaganych
informacji, zasady retencji i wymagania właściwej jurysdykcji. Nie deklarujemy
pełnej zgodności prawnej.
