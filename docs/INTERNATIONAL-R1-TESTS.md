# R1 — rzeczywiste wyniki i granice

23.10.2026. Testy tej sesji na zintegrowanym drzewie R1, wyłącznie fikcyjne dane.
Nie testowano konta właściciela, Contabo ani danych produkcyjnych.

## Zaliczone

| Test | Wynik i rzeczywisty zakres |
| --- | --- |
| Dotychczasowe celowane unit/guard | **55 PASS**: gateway, profil produkcyjny, zachowanie danych, backup GCM, migrator i odzyskanie ról, walidacja VAULT. Po rozszerzeniu odcisków ponowiono zmieniony podzbiór **13/13**, nie doliczamy go jako nowych testów |
| Guard pakietu staging | **2/2 PASS**: publiczne porty tylko lokalnego gatewaya oraz brak sekretów/DB w build context |
| Nowe testy planera R1 | **3/3 PASS**: zmiany tylko app, odmowa driftu, rzeczywisty merge dwóch overlayów Compose, zaszyfrowana kopia i odtworzenie plików konfiguracji, skrypty wymagające potwierdzenia, odmowa błędnego SHA/Basic Auth/health. Odpowiedzi HTTP tego ostatniego testu są syntetyczne |
| Realny VAULT V1 + V2 | **17 grup PASS**: PostgreSQL 17, GoTrue 2.184.0, Node BFF i Chromium; bez atrap API |
| Dodatkowa realna regresja R1 | **7 grup PASS**, z checkpointami i wznowieniami opisanymi niżej |
| Realny Caddy/TLS | **4 grupy PASS**: lokalnie zaufany certyfikat, dwa hosty, reverse proxy, brak Basic Auth, noindex n8n, ochrona forwarded headers, WebSocket 101 i zachowane ID kontenerów/porty loopback |

### 17 grup VAULT

Fikcyjne siedem ról personelu oraz Buyer/Supplier/Partner, rzeczywiste logowanie
i MFA; migracje 015→016→017, kopie przed migracjami i niezmienione wcześniejsze
wiersze kont/sesji/MFA/VAULT; API/SQL/RLS; CSRF, świeże MFA, dane i audyt wyłącznie
OWNER; deduplikacja, konflikty, historia, paginacja, limity; rzeczywisty interfejs
desktop/mobile, wylogowanie w dwóch kartach, brak CRM dla pozostałych ról.
Sprawdzono też przedziały nocy Oslo z obiema zmianami czasu.

### 7 grup R1

1. Wyłączone ścieżki mailowe rzeczywiście zwracają 503; kontakt wymaga CSRF,
   zapisuje zgłoszenie do PostgreSQL, a zwykły Buyer nie może odczytać kolejki.
2. Siedem ról dostaje listy zgodnie z rzeczywistym permission set; nikt poza
   OWNER nie może odebrać roli OWNER lub nadać jej sobie przez API.
3. Supplier tworzy/przekazuje ofertę, Procurement przeprowadza kwalifikację
   i zatwierdza; Buyer tworzy/przekazuje RFQ, Sales podejmuje decyzję i udostępnia
   zanonimizowaną okazję; Operations tworzy projekt Partnera. Faktyczne liczniki
   zmieniają się; PLN zachowuje walutę źródłową.
4. Drugi Buyer nie widzi przypisanej innemu okazji, cudzych RFQ, ofert źródłowych
   ani VAULT. Supplier i Partner nie uzyskują cudzych danych źródłowych.
5. Rzeczywiste panele wszystkich dziesięciu ról (7 staff + 3 commercial), szerokości
   1440/390/320 px bez poziomego overflow; axe WCAG A/AA w obszarze dashboardów
   bez naruszeń. Siedem stron publicznych sprawdzono mobilnie na działającym BFF.
6. AES-256-GCM: pełny dump, szyfrowanie, uwierzytelnione odszyfrowanie i odtworzenie
   do **drugiego klastra PostgreSQL, z oddzielnym PGDATA i socketem, bez TCP**.
   Odtworzono i porównano pełne odciski **71 tabel** sb/portal/owner_vault/Auth
   oraz ledgeru. Zgodne dane i ACL/FORCE RLS; źródło niezmienione. To drugi klaster
   w tym samym izolowanym kontenerze testowym, nie osobny VPS/kontener ani komplet
   wszystkich produkcyjnych usług. Oryginalne backupy pozostają zachowane.
7. Zatrzymanie i ponowny start realnego procesu BFF, następnie wykonanie realnego
   kodu `7f794a2` na tej samej DB 017 i powrót do R1. Dotychczasowe sesje działają,
   OWNER zachowuje aal2/MFA, oferty/RFQ i dane VAULT pozostają. Stary kod słusznie
   nie ma endpointów VAULT. **Nie jest to test rollbacku obrazów Docker.**

Caddy działał naprawdę, natomiast jego upstreamy aplikacji i n8n w osobnym teście
protokołu były jawnie fikcyjnymi usługami Node. Nie łączymy tych dowodów w
nieprawdziwą deklarację pełnego testu produkcyjnego Compose lub rzeczywistego n8n.

## Wznowienia i poprawki testów

Pierwszy przebieg ukończył wszystkie 17 grup VAULT, po czym zatrzymał się w nowym
teście R1 z błędną nazwą endpointu: użyto `contact-enquiries`, gdy działający
endpoint to `contact-queue`. Poprawiono test, nie tworzono drugiego endpointu.

Zachowano kontenery i DB, wykonano kopię przed dodaniem kolejnych fikcyjnych
aktorów R1. Konta poprzedniego fixture nie były resetowane. Nowy runner zapisuje
prywatny checkpoint aktorów i wynik po każdej grupie. Zaliczone grupy pozostają
zachowane zamiast wielokrotnego uruchamiania.

Usunięto też błędy nowego harnessu: nieobsługiwane `compose start --wait`, nazwę
selektora Command Center i brak `docker exec -i` przy przekazywaniu SQL na stdin.
Przy zastępowaniu procesu HTTP dopuszczono jedno ponowienie wyłącznie GET po
konkretnym błędzie zerwanego keepalive. Zachowany katalog rollbacku jest sprawdzany
z oryginalnym blobem Git zamiast nadpisywany. Nie są to dowody naprawy nieistniejących
błędów rejestracji/produkcji. Końcowe siedem grup R1 ma PASS.

Po rozszerzeniu ochrony na portal i całe Auth ponowiono **tylko** odtworzenie
backupów i zmienione testy guardów; otrzymano 71 identycznych tabel. Pozostałe
wyniki zachowały wiarygodność: ich kod runtime nie zmienił się.

## Niewykonane / zablokowane

- Oficjalny build i pełny produkcyjny Compose z DB/Auth TLS, obrazami R1 i aktywnym
  gatewayem oraz rollback tych obrazów. Dostępne miejsce spadło z ok. 1,3 GB
  do ok. 143 MB; nie usuwano zasobów i nie rozpoczynano ryzykownego builda.
- Pełne odtworzenie działającego stosu i danych trwałych Caddy/TLS z archiwów;
  test SQL i unit odtwarzania konfiguracji nie zastępują tego ćwiczenia.
- Publiczne HTTPS i rzeczywisty n8n. Odczyt HEAD `/health` oraz `/healthz` na obu
  domenach, także ponowiony poza sandboxem, zatrzymało proxy: `CONNECT 403`,
  `server: envoy`. Nie przedstawiamy tego jako HTTP 403 otrzymanego z aplikacji.
- Działające SMTP, dostarczenie e-maili, nowa rejestracja i reset przez e-mail.
  W testowanym profilu są celowo wyłączone. Nie wysłano rzeczywistych wiadomości.
- Weryfikacja roli rzeczywistego konta OWNER, pełna awaryjna utrata TOTP,
  fizyczne telefony/czytnik ekranu/Safari/Firefox i testy obciążenia.

## Artefakty i uruchamianie — dla testującego kod

Prywatne konfiguracje/backupy/wyniki i fikcyjne zrzuty pozostają w ignorowanym
`.local/vault-test-60fd63a0e2`. Publiczny [plik wyników](INTERNATIONAL-R1-RESULTS.json)
zawiera tylko nazwy kontroli, statusy i sumy publicznych źródeł, bez danych testowych
lub konfiguracji. Nie publikować `.local`, dumpów ani kluczy.

Ścieżka testowa dla nowego, odpowiednio dużego środowiska deweloperskiego:

```sh
SHADOWBRIDGE_TEST_VAULT_V2=1 node tests/owner-vault.integration.mjs
node tests/international-r1.integration.mjs --dir=.local/vault-test-ID_Z_POPRZEDNIEGO_KROKU
```

Runner R1 odmawia pracy bez markera i 17 zachowanych zaliczonych grup, sprawdza,
że wszystkie konta mają domenę `.invalid`. Nigdy nie używa `.local/development.env`
ani projektu właściciela. Wznawiany fixture musi należeć do tego konkretnego checkoutu.
Test gatewaya wymaga istniejącego, zatrzymanego fikcyjnego wire fixture; nie
akceptuje produkcyjnego projektu. Żaden runner R1 nie usuwa kontenerów/wolumenów.
Dotychczasowy `shadowbridge-private-local` zachowuje oryginalne działające ID.
