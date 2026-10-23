# OWNER VAULT V2 — raport checkpointu

23.10.2026, Europe/Oslo. Gałąź `feature/owner-vault-v2`, baza V1
`6d200ee084872b6c3123346e2f77c61010c94049`. **Nie wykonano deployu.**

## Faktycznie wykonane

- W istniejącym Command Center: OWNER-only nawigacja, firmy/kontakty,
  szczegóły, źródła, daty i stany weryfikacji; wyszukiwanie, filtry i paginacja.
- Cztery klikalne kafelki z rzeczywistego PostgreSQL: Companies, Contacts,
  Duplicates Prevented, Overnight Activity. Ostatni sumuje nowe firmy i kontakty
  w ostatniej zakończonej nocy 18:00–08:00 Europe/Oslo.
- Osobna kolejka otwartych intakes, archiwum rozstrzygnięć i prywatna historia
  zmian. Ręczne udokumentowane powiązanie/dismissal, bez nadpisania pierwotnego
  zgłoszenia lub przejmowania cudzych mocnych kluczy.
- Kontrolowana edycja firmy/kontaktu i decyzje weryfikacji: walidacja JS/SQL,
  bieżąca wersja, świeże MFA, CSRF, niezmienny before/after i audyt.
- Migracja 017: `company_versions`, `changes`, `resolutions`, funkcje, jawne ACL
  i FORCE RLS. Wszystkie stare wiersze/schematy tabel i migracje 001–016 zachowane.
- Zachowany design i dotychczasowe przepływy. Brak danych CRM w ogólnym audycie
  pracowników, publicznym interfejsie, n8n/Scout/Sentinel ani przeglądarkowych
  storage. Wylogowanie i zmiana sesji czyszczą prywatny interfejs.

## Najnowsze wyniki, wykonane w tej sesji

**17 grup rzeczywistej integracji — PASS:** PostgreSQL 17, GoTrue 2.184.0,
serwer Node/BFF i Chromium, bez atrap odpowiedzi. Pierwszych dziewięć grup to
regresja fundamentu V1; następnych osiem dotyczy V2.

1. Fikcyjne konta siedmiu ról personelu i Buyer/Supplier/Partner; rzeczywiste MFA.
2. Backup, bezpieczna odmowa kolizji i migracja 015→016; zachowane konta/sesje/MFA.
3. HTTP OWNER+MFA, odmowy pozostałych ról i brak CSRF, prywatny audyt odmów.
4. Deduplikacja mocnymi kluczami; wspólne skrzynki/nazwiska nie łączą osób.
5. Stronicowanie, wyszukiwanie, weryfikacja z wersją, niezmienność historii V1.
6. FORCE RLS/ACL i SQL odmowy; brak dostępu ról staff/policy/Sentinel/Auth/sessions.
7. Fikcyjny, następnie wyłączony agent V1: tylko receipt, binding źródła,
   idempotencja, wyścigi, limit. Nie utworzono żadnej integracji poza tym fixture.
8. Liczniki V1, przed 08:00 i obie zmiany czasu Oslo.
9. Brak CRM w ogólnym Overview/audycie i zachowane sesje/czynnik MFA fixture.
10. Kopia przed 017; migracja 016→017. **Identyczne pełne odciski wszystkich
    sześciu istniejących tabel VAULT** oraz sprawdzanych tabel bezpieczeństwa
    sb/Auth: kont, grantów, haseł, sesji i MFA.
11. Nowe API: brak sesji 401, OWNER bez MFA 403, pozostałe dziewięć ról 403.
    SQL/RLS sprawdzono niezależnie od ukrycia UI, także jako executor z różnymi
    claims; brak surowych praw API, ingest, Sentinel, policy i sessions.
12. Firmy/osoby, źródła i szczegóły, powiązane kontakty, kraj/status/search,
    strony, nieistniejący ID, SQL injection w filtrze i błędne/nadmiarowe parametry.
13. Edycja firmy i osoby, CSRF, nieświeże MFA, chronione pola, kolizje tożsamości,
    dwa równoczesne zapisy: jeden 200 i jeden 409; prywatne before/after,
    niezależne statusy osoby i firmy, odmowa zmiany/usunięcia historii.
14. Rozstrzygnięcie konfliktu, odmowa przejęcia cudzych kluczy/kandydata spoza
    zgłoszenia, powtórnej decyzji; zachowane oryginalne intakes i kontakt;
    kolejka i licznik duplikatów zgodne z historią.
15. Liczniki zgodne z listami; overnight firmy + kontakty, koniec wyłączony,
    okresy 13/15 h i poprzednia zakończona noc przed 08:00; zegar API niepodrabialny.
16. Chromium z **rzeczywistym backendem**: normalny formularz logowania, istniejące
    MFA, cztery kafelki i ich podstrony, edycja przez UI, szczegóły przy 1440/390/320 px,
    brak poziomego overflow, axe WCAG2 A/AA (zero zgłoszonych naruszeń), brak
    localStorage/sessionStorage, wylogowanie w dwóch kartach, brak menu i żądań
    VAULT we wszystkich dziewięciu innych rolach. Nie symulowano sukcesu logowania.
17. Limit odczytów: nadmiar daje 429; inne zweryfikowane konto nadal działa.

**14 testów jednostkowych/źródeł — PASS:** siedem walidacji V1/V2 i siedem testów
loadera/historii migracji 001–017. To nie są testy bazy, odróżniamy je od powyższych.

**4 dodatkowe testy prezentacji z atrapą HTTP — PASS:** istniejące Owner Overview,
Operations/Analyst, brak fikcyjnych zer i czyszczenie po zmianie sesji. Nie są
przedstawiane jako testy rzeczywistego backendu.

Wyniki maszynowe i sumy testowanych plików:
[OWNER-VAULT-V2-RESULTS.json](OWNER-VAULT-V2-RESULTS.json).

Komendy reprodukcji w izolacji (narzędzia testowe muszą być już dostępne):

```sh
node --test server/tests/owner-vault.test.mjs tests/staging-migrate.test.mjs
SHADOWBRIDGE_TEST_VAULT_V2=1 node tests/owner-vault.integration.mjs
node /path/to/existing/playwright/cli.js test --config tests/dashboard.config.cjs --grep 'E monitor|C shell: a changed session'
```

Harness tworzy własny losowo nazwany projekt, fikcyjne zweryfikowane e-maile
administracyjnie w GoTrue i potem wykonuje normalne logowanie/MFA. Nie testuje
rejestracji e-mail, nie wysyła wiadomości i nie wczytuje `.local/development.env`.
Testy nie są skryptem produkcyjnym ani sposobem zakładania realnego OWNER.

## Naprawy ujawnione podczas testów

- Wspólny limit 40 żądań/IP blokował zwykłe przeglądanie CRM i współdzielące IP
  konta. VAULT ma teraz osobno 240 odczytów i 40 zmian/5 min na zweryfikowane
  konto+adres. Nadmiar i niezależność kont sprawdzono rzeczywiście, bez wyłączenia limitów.
- Wersjonowanie firm przeniesiono do osobnej metadanej bez backfillu; nie trzeba
  osłabiać istniejącej ochrony odcisków danych przy migracji.
- Guard liczby migracji dostosowano do 017; test V1 świadomie nadal bada 001–016.
- Poprawiono niejednoznaczny selektor dwóch list szczegółów w teście przeglądarki.
  Był to błąd harnessu, nie dowód nieskutecznej edycji aplikacji.

Końcowy przebieg integracyjny zakończył się kodem 0, 17 PASS. Wcześniejszych
prób przerwanych na limiterze lub selektorze nie przedstawiamy jako zaliczonych.

## Dysk, dane i kopie

Przed dużymi testami około **1,4 GB** wolnego na dysku roboczym; harness odmawia
startu poniżej 512 MiB. W trakcie około 0,6 GB; po usunięciu wyłącznie własnych
zasobów około **1,3 GB**. Dokładne końcowe wartości są w JSON wyników.
Chromium korzystał z `/tmp` dla danych tymczasowych oraz prywatnego cache fixture;
nie instalowano zależności aplikacji ani nie budowano dużych obrazów.

Przygotowano faktyczne dumpy PostgreSQL przed 017 i po zakończonych testach,
wyłącznie z fikcyjnymi danymi. Pozostały prywatne, z prawami 0600, poza Git wraz
z diagnostyką i zrzutami desktop/mobile. Testy zamknęły API i przeglądarkę.
Usunięto tylko kontenery/sieci/wolumeny nowych fixture utworzonych w tym zadaniu,
bez kasowania backupów. Wcześniejsze kontenery/obrazy/wolumeny, lokalna instalacja
właściciela, konto i MFA pozostały nietknięte; zgodność uruchomionych kontenerów
przed/po jest automatycznie sprawdzana przez harness.

## Granice / decyzje przed dalszym użyciem

- **Rzeczywista rola konta właściciela na Contabo pozostaje niezweryfikowana.**
  Dostęp daje wyłącznie faktyczny OWNER+MFA, nie nazwa „Vincent”. Nie nadawano
  roli ani nie zmieniano jego konta/CRM. Wyjaśnienie roli należy do właściciela/operatora.
- Nie wykonano produkcyjnego obrazu, integracji release z działającym gatewayem
  n8n, publicznego TLS, wdrożenia, migracji realnej bazy ani testu rollback/pełnego
  odtworzenia kopii po 017. Bezpieczny przyszły proces opisano w
  [OWNER-VAULT-V2-RELEASE.md](OWNER-VAULT-V2-RELEASE.md).
- Brak automatycznego scalania, przenoszenia osoby do innej firmy, edycji kraju/
  numeru rejestrowego i kasowania historii. Silnie sprzeczne tożsamości wymagają
  wyjaśnienia/dismissal, nie nadpisania dowodów. Nowy company-only intake to V3.
- Import prawdziwych danych, retencja, kontrolowane usunięcie i podstawy
  przetwarzania wymagają oddzielnych decyzji. Żadnych danych zewnętrznych,
  n8n/Scout/Sentinel/AI ani płatnych usług nie podłączono.

Interfejs i API są gotowe do lokalnego przeglądu na zatwierdzonej bazie testowej.
Nie jest to zgoda ani deklaracja gotowego wdrożenia produkcyjnego. Po commicie
i PUSH zatrzymujemy się na checkpointcie V2.
