# MCP READ ONLY: plan kontrolowanej aktualizacji, bez wykonania

25.10.2026, Europe/Oslo. **PREPARED: plan do przeglądu. Nie wykonano deployu,
backupu produkcyjnego, migracji, wydania klucza ani testu ChatGPT.**

## Tożsamość i kontrakt

- Baza: `236e04bded81c406fb49ee0950ae20d139f257ec`. OWNER przekazał udany wynik
  `API_ENABLED_CHATGPT_NOT_CONNECTED`, `ownerInteractiveAcceptance:true`.
  Nie zastępuje to nowego odczytu stanu kontenera i manifestów.
- Kandydat aplikacji: `45ed3ee306e0d293b95c15f10aaff4aeabdf208a`.
  Różnica to 5 plików: moduł MCP, routing, flaga konfiguracji, test i dokumentacja.
  Migracje 001–018, zależności, UI oraz konfiguracje deploy pozostają identyczne.
- Endpoint po późniejszym wdrożeniu:
  `https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp`.
- Transport klienta: `streamable-http`; bezstanowy POST JSON-RPC, odpowiedzi JSON.
  `Content-Type: application/json`; `Accept: application/json, text/event-stream`.
  Negocjowane wersje `2025-06-18` / `2025-03-26`. GET/DELETE: 405.
- Uwierzytelnianie klienta: `api_key`, `headerScheme: bearer`, nagłówek
  `Authorization: Bearer <prywatny sekret>`. Nie umieszczać sekretu w URL.
- Jedno narzędzie: `read_notes`; jedyny wymagany zakres: `note.read`.
  Przykład argumentów bez danych prywatnych: `{"page":1,"q":"TEST-CONNECTION-NOTE"}`.
- Aktywna rola OWNER, zweryfikowane e-mail/TOTP, wygaśnięcie/cofnięcie klucza,
  RLS/RPC, audyt i limity pozostają egzekwowane. Bez cookie/Origin i bez CORS.

## Obowiązkowa kolejność późniejszej aktualizacji

1. **Preflight tylko odczytowy.** Potwierdzić pełny SHA checkoutu i kontenera,
   źródła obrazu, `state.json` odbioru 236e04b, aktywny plan R1 i wszystkie jego
   fingerprinty wraz z wcześniejszym planem d5582ff. Sprawdzić HTTPS/n8n,
   ledger 001–018, OWNER/TOTP, sieci, wolumeny, brak publicznych portów DB/Auth,
   miejsce na build oraz kopie. Brak dowodu lub rozbieżność oznacza STOP.
2. **Przygotować osobny plan app-only.** Zachować obecny obraz i kompletny
   override środowiska 236e04b. Kandydat musi mieć OCI revision 45ed3ee i zgodne
   pliki źródłowe. Dopuszczalna zmiana: obraz app, RELEASE_SHA i jawna flaga MCP.
   `OWNER_BOOK_API_ENABLED=true` pozostaje zachowane. Nie edytować aktywnych
   manifestów, konfiguracji podstawowej, GoTrue, gatewaya, n8n ani sekretów.
3. **Backup przed wymianą.** Użyć istniejących mechanizmów szyfrowania R1 do DB,
   konfiguracji i stanu certyfikatów; objąć też aktywny plan oraz checkpoint
   236e04b. Zweryfikować integralność/authentication archiwów i potwierdzić
   kopię poza VPS wraz z SHA. Klucze oddzielnie, prywatne pliki 0600/0700.
   Backup pozostaje u operatora, nigdy w repozytorium ani środowisku Codexa.
   Uzgodnić wymaganą krótką przerwę app/Auth/Caddy dla spójnej kopii.
4. **Wymiana tylko app, po osobnej zgodzie.** Żadnego migratora. Wszystkie
   pozostałe kontenery, ID, środowiska, sieci i wolumeny mają pozostać zgodne.
   Najpierw uruchomić kandydat z MCP wyłączonym i potwierdzić zdrowie oraz
   istniejące logowanie OWNER/TOTP. Aktywację MCP wykonać wyłącznie przez
   zweryfikowany nowy override/plan, nie przez ręczną zmianę pliku prywatnego.
5. **Odbiór transportu i odczytu.** Po aktywacji anonimowe poprawne POST MCP
   ma zwrócić 401, a nie notatki. Dopiero po potwierdzeniu bezpiecznego pola
   sekretu w integracji OWNER może wydać 1-dniowy klucz `note.read`.
   `initialize` → `notifications/initialized` → `tools/list` (dokładnie jedno
   `read_notes`) → `tools/call`. Odczytać fikcyjną notatkę i porównać jej ID/treść
   z UI. Zwykła rola bez uprawnienia, brak zakresu i cofnięty klucz mają odmówić
   odczytu. Sprawdzić audyt bez sekretów. Nie dodawać narzędzi zapisu.
6. **Wyłączenie i rollback.** Przy problemie wyłączyć sam MCP przez nowy
   zatwierdzony override. Jeśli aplikacja nadal nie przechodzi odbioru,
   odtworzyć tylko poprzedni obraz/override app 236e04b. Zachować REST API,
   nowe wpisy, konta i MFA. Nie przywracać starej bazy na produkcję, nie kasować
   wolumenów, nie ponawiać migracji. Zweryfikować SHA/HTTPS/n8n/OWNER po cofnięciu.

## Blokady wykonania tego planu

Istniejący `r1-owner-deploy.mjs --book-api` obsługuje aktualizację **z d5582ff**,
nie z aktywnego 236e04b. Planer dopuszcza tylko historyczne bazy 7f794a2/d5582ff
i nie dopuszcza jeszcze zmiany flagi MCP. Nie wolno uruchamiać tego instalatora
ponownie, zmieniać mu ręcznie SHA bazowego ani pomijać fingerprintów.
Przed wdrożeniem trzeba osobno zaimplementować i przetestować obsługę bazy
236e04b, zachowania REST=true, nowej flagi MCP oraz rollbacku w tych narzędziach.
**To plan aktualizacji, nie gotowy ani przetestowany instalator dla MCP.**

Druga blokada: deklaracja Plugin Creator o `api_key/bearer` nie dowodzi, że
sekret będzie poza pakietem, modelem, kodem klienta i logami. W tej sesji brak
narzędzia create_plugin i autoryzowanego odczytu Book. Pole Authentication oraz
serwerowe przechowywanie/cofanie sekretu trzeba potwierdzić przed jego wydaniem.
Nie wygenerowano klucza i nie proponujemy słabszego mechanizmu OWNER/MFA.

Historyczny wynik adaptera: 8 grup HTTP z fiksturą SQL + 4 regresje REST PASS.
Nie powtarzano ich przy zmianie wyłącznie dokumentacji. Wciąż nieprzetestowane:
klient Plugin Creator/SDK, nowy update runner, aktualizacja/rollback MCP na
rzeczywistej instalacji, `read_notes` na produkcji. Status połączenia: NOT CONNECTED.
