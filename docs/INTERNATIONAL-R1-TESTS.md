# R1 — rzeczywiste wyniki i granice

## Końcowy audyt przed Contabo — 24.10.2026

**29 różnych celowanych przypadków PASS**: 13 nowych inventory/budget oraz
3 R1, 9 production-ops i 4 password-recovery. Powtarzane podzbiory nie zwiększają
liczby. Testy katalogu porównały wszystkie 61 plików bazowej wersji z Git 7f794a2,
17 migracji i rzeczywiste pliki zachowanych fikcyjnych profili. Testy HTTP są
syntetyczne; potwierdziły brak jakiegokolwiek POST w preflight. Odczytano również
rzeczywiste mounts/statfs/inody Codexa i sprawdzono odmowę ciężkich testów
z /workspace/default Docker. Nie wykonywano nowej pełnej integracji, budowy,
resetu hasła, migracji lub testów na Contabo.

Zachowane poniżej dowody backendu/runtime pozostają historyczne. Zmiany dotyczą
wyłącznie hostowych narzędzi, guardu testów i dokumentacji. Ostateczna gotowość:
**READY FOR PREFLIGHT**, zgodnie z [końcowym audytem](INTERNATIONAL-R1-FINAL-AUDIT.md).


## Domknięcie 24.10.2026

- **4/4 build PASS**: oficjalny Dockerfile, Node 24 Alpine, runtime i migrator
  dla 7f794a2 oraz R1 faed3e4. Jedynym dodatkiem Dockerfile przy budowie starszego
  kodu była ta sama etykieta OCI; stary runtime pochodził z oryginalnego Git archive.
- **6/6 grup full stack PASS** (`tests/international-r1-stack.integration.mjs`):
  produkcyjny Compose i overlay gatewaya, PostgreSQL 17, GoTrue 2.184.0, Caddy,
  rzeczywisty n8n 2.44.6. TLS DB/Auth z verify-full, normalne logowanie, OWNER MFA,
  firma Buyer i RFQ, aktualizacja 015→017, sesje i VAULT, wymiana oraz rollback
  rzeczywistych obrazów i ponowne R1. Odczytowy preflight również zaliczony.
- **Pełny restore PASS** do osobnego projektu Compose i osobnych wolumenów:
  SQL + prywatna konfiguracja, publiczny profil/gateway i dane Caddy, wszystkie
  zaszyfrowane AES-256-GCM. 70 tabel Auth/sb/portal/VAULT + osobno ledger 17 migracji
  (łącznie 71 tabel) identyczne. 13 plików Caddy sprawdzonych po skopiowaniu
  do celu, nie tylko po odszyfrowaniu. Zachowano klucze DB/JWT/sesji, token proxy
  i certyfikaty; ścieżki/projekt manifestów zmieniono wyłącznie w nowym celu.
  Odtworzony stos obsłużył dotychczasowe sesje OWNER aal2 i Buyera, VAULT/RFQ
  oraz świeże logowanie dotychczasowym hasłem.
- **64/64 pliki runtime zgodne** z aktualnym drzewem, odczyt ze zbudowanego obrazu.
  Obraz nie zawiera wyłączonych przez .dockerignore prototypów.
- **16/16 celowanych testów PASS**: planer R1, production-ops i recovery ról;
  to ponowiony podzbiór wcześniejszych testów, nie dodatkowe 16 różnych testów.

Testy nie dotknęły Contabo, rzeczywistych użytkowników ani pierwotnego lokalnego
projektu właściciela. Wszystkie trzy jego działające ID pozostały te same.
Na osobnym daemonie w /tmp użyto overlay2; nie usuwano dotychczasowych zasobów
ani żadnych wolumenów/backupów. Compose wymieniał kontener aplikacji wyłącznie
we własnym fikcyjnym projekcie podczas testu aktualizacji. Kontenery testowe
zatrzymano, dane zachowano. Nie prowadzono wysyłki e-mail ani importów CRM.

Rozwiązano wyłącznie problemy nowego testu: brak symlinków iptables w minimalnym
środowisku zagnieżdżonego Dockera, UID tmpfs cache n8n oraz oczekiwanie na oba
endpointy n8n (health jest gotowe wcześniej niż frontend). Nie zmieniano z tego
powodu aplikacji ani produkcyjnej konfiguracji n8n. Pełny restore ponowiono
wyłącznie po dodaniu sprawdzenia kopii publicznej konfiguracji; pięć poprzednich
grup zachowano. Ledger porównano dodatkowym odczytem dwóch baz, bez powtarzania
pozostałych testów.

**Granice:** publiczne ACME zastąpiła lokalna CA dla obu prawdziwych nazw hostów.
Żaden port testu nie był publikowany na zewnętrznym hoście; porty istniały tylko
w przestrzeni sieciowej izolowanego kontenera-daemona. Nie potwierdzono domen
produkcyjnych, danych/roli realnego OWNER ani fingerprintów istniejącego Contabo.
Wymagany przed aktualizacją preflight wykona tam odczyt; nie zmienia żadnych kont.
Brak SMTP nadal świadomie blokuje nowe rejestracje i odzyskiwanie przez e-mail.

Wyniki starsze poniżej pozostają dowodem dla niezmienionego runtime; nie
uruchamiano ponownie całej regresji UI/ról.

## Zachowane wyniki 23.10.2026

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

## Niewykonane / zablokowane na checkpointcie 23.10 (historia)

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

Nowy full-stack runner wymaga **osobnego pustego Docker daemona** overlay2
(data-root /tmp/shadowbridge-r1-isolated/overlay-data), nigdy domyślnego daemona
właściciela lub Contabo. W tej sesji powstał w prywatnym kontenerze bez portów
hosta, z lokalnymi kopiami przypiętych obrazów. Wrapper
`tests/fixtures/international-r1-docker.py` przekierowuje komendy do tego jednego
socketu i dodaje lokalny overlay CA/portów; nie symuluje odpowiedzi. Wymaga
prywatnego wrapper.json z pustym overlays i instalacji wrappera jako bin/docker
w tym samym katalogu testowym. W minimalnym rootfs daemona potrzebne są działające
iptables/ip6tables (w tym symlinki /etc/alternatives); inaczej nie działa DNS.
Przed testem buduje się po dwa obrazy z oficjalnego Dockerfile: tagi
shadowbridge-r1-full:{baseline,candidate} i shadowbridge-r1-migrate:{baseline,candidate},
z odpowiednim SHADOWBRIDGE_RELEASE_SHA. Repo zachowuje własne test dependencies. **Od końcowego audytu ciężki suite wymaga
całego checkoutu i jego .local na tej samej puli /tmp co Docker. Nie uruchamiać
go ponownie z /workspace. Zachowane wcześniejsze fixture/wyniki nie są przenoszone
ani resetowane dla ominięcia tego guardu.**

Uruchomienie dla dewelopera po przygotowaniu takiego izolowanego daemona/obrazów:

```sh
PATH=/tmp/shadowbridge-r1-isolated/bin:$PATH SHADOWBRIDGE_R1_ISOLATED_TEST=1 SHADOWBRIDGE_R1_TEST_GATEWAY_ADDRESS=172.17.0.X node tests/international-r1-stack.integration.mjs
```

Adres to prywatny bridge kontenera-daemona (odczyt docker inspect), nie VPS.
Do wznowienia służy --dir=.local/r1-stack-ID; --repeat-recovery ponawia tylko
ostatnią grupę do nowego celu i zachowuje wcześniejsze kopie. Nowy fixture
ma wyniki i sekrety jedynie w ignorowanym .local; nic z niego nie wysyłać do GitHub.
Nie jest to instrukcja wymagająca wykonania przez właściciela.


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
