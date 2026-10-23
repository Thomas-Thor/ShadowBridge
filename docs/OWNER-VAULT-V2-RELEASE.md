# OWNER VAULT V2 — przyszła aktualizacja, bez wykonania wdrożenia

**Ten dokument nie jest zgodą ani skryptem automatycznego wdrożenia.** Obecnie
nie łączono się z Contabo, nie stosowano migracji tam ani w bazie właściciela,
nie zmieniano n8n, Caddy, DNS, logowania/MFA ani publicznej strony.

## 1. Przygotowanie zatwierdzonego release

Po osobnej zgodzie OWNER operator ustala rzeczywisty SHA działającej produkcji,
historię migracji i zatwierdzony fingerprint/manifest konfiguracji. Zachowuje
bieżący commit/tag, obrazy rollback i prywatną konfigurację.

Gałąź V2 pochodzi z `feature/secure-b2b-mvp` z V1, **nie z całego najnowszego
pakietu infrastrukturalnego**. Zmiany gatewaya n8n są na oddzielnej gałęzi
`fix/n8n-https-gateway` (`9a64cc0`). Nie wdrażać całej gałęzi V2 wprost przez
podmianę katalogu/repozytorium ani kopiowanie starych plików deploy.

Przygotować osobny release integracyjny zachowujący faktycznie wdrożoną wersję
gatewaya (w tym `N8N_WEBHOOK_URL`, sieć edge i obsługę manifestu). Do niego włączyć
zatwierdzone V1/V2, bez cofania nowszych poprawek infrastruktury. Sprawdzić diff
pliku Caddy/Compose/gateway/manifestu względem produkcji; V2 nie wymaga ich zmian.
Powtórzyć dotychczasowe testy gatewaya na tym release. Nie regenerować sekretów
ani nie „naprawiać” różnic fingerprintu przez ślepe nadpisanie konfiguracji.

**Nie wykonano jeszcze budowy ani testu takiego łącznego release.** Ten pakiet
potwierdza moduł aplikacyjny, nie gotowość dowolnej gałęzi do podmiany produkcji.

## 2. Kopia i przygotowanie bazy

Operator korzysta z istniejącego mechanizmu zaszyfrowanych kopii instalacji:
pełny PostgreSQL (Auth, sb i owner_vault), konfiguracja i klucze poza Git.
Sprawdza archiwum i odtworzenie do **oddzielnego pustego celu**. Zachowuje kopię
i klucz oddzielnie, również poza VPS. Nie odtwarza niczego na działającą bazę.

W oknie utrzymaniowym zatrzymuje zapisy przez aplikację i kontroluje brak
procesów zapisujących; nie zatrzymuje/usuwa n8n ani jego danych. Zapamiętuje
odciski istniejących tabel, kont, haseł, MFA, sesji i grantów istniejącym narzędziem.

Przez istniejący migrator z dedykowanym DBA/TLS stosuje tylko brakujące migracje
w prawidłowej kolejności. Jeśli 016 nie ma w bazie, najpierw V1 i jego warunki
bezpiecznej odmowy przy kolizji schematu/roli. Potem 017. Historia 001–016 i jej
sumy muszą być zgodne; nie zmieniać wpisów provenance ręcznie.

017 tworzy trzy nowe tabele/funkcje/polityki; nie zmienia starych wierszy ani
schematu tabel firm/kontaktów. Na fikcyjnej bazie potwierdzono identyczne pełne
odciski wszystkich sześciu starych tabel VAULT przed/po migracji oraz danych
bezpieczeństwa sb/Auth. Nie potrzeba wyłączać `assertPreserved` dla VAULT.

**Przerwanie:** przy błędzie migrator wycofuje bieżącą transakcję. Nie uruchamiać
nowego obrazu, nie resetować bazy i nie usuwać wolumenów; zachować diagnostykę.
Nieudane 017 nie oznacza cofnięcia wcześniej zakończonej 016.

## 3. Obraz aplikacji i kontrola dostępu

Istniejący Dockerfile kopiuje nowe `server/*.mjs`, `assets/*.js/css` i stronę
`portal/admin/`; migrator kopiuje wszystkie SQL. Nie włączać nowych portów,
serwisów, SMTP ani integracji. Przebudować zatwierdzony obraz aplikacji/migratora
i użyć istniejącego mechanizmu aktualizacji dla tej samej instalacji/projektu.
Zachować `.local`, hasła, klucze sesji/JWT, bazę i istniejące wolumeny.

Po uruchomieniu operator sprawdza health i wersję, a właściciel:

1. Loguje się dotychczasowym kontem, potwierdza istniejące MFA.
2. Sprawdza, czy istniejące przypisanie daje OWNER; jeśli nie — zatrzymuje test
   dostępu i zgłasza rozbieżność. **Nie nadawać roli, nie resetować hasła/MFA.**
3. Otwiera Overview, wszystkie cztery kafelki, firmy/kontakty/kolejkę i stronicowanie.
4. Potwierdza brak VAULT dla innych ról; zmian nie testuje na realnym kontakcie
   bez odrębnego upoważnienia. Do prób zapisu używa zatwierdzonych fikcyjnych danych.
5. Sprawdza dotychczasowe funkcje aplikacji oraz HTTPS gatewaya automation.

## 4. Wycofanie i ograniczenia

Nie ma automatycznego downgrade ani DROP nowych tabel. Zachować 017 i prywatną
historię. Stary runtime V1 może nadal korzystać ze swojego API (V2 jest addytywne),
ale **pełnej procedury rollback obrazu po 017 nie wykonano na połączonym pakiecie**.
Należy ją sprawdzić na odtworzonej kopii przed zatwierdzeniem produkcji.

Nie wdrażać obrazu starszego niż V1, który nie zna VAULT, bez osobnego planu.
Nie wymuszać starszej historii migracji i nie kopiować backupu na bieżącą bazę.
Jeśli potrzebne odtworzenie danych: odrębny pusty cel, porównanie danych i osobna
decyzja OWNER o przełączeniu. Nie usuwać dowodów ani nowych zapisów „dla rollbacku”.

Przed rzeczywistym importem pozostają decyzje o retencji/usuwaniu, podstawach
przetwarzania i źródłach. V3/n8n/Scout/AI nie są aktywowane w tym release.
