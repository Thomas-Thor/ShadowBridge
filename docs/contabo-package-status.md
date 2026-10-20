# Pakiet Contabo — punkty kontrolne

Punkt wyjścia: `c3c32a640e2a3dbf007c12d4415031d72832134b` na
`feature/secure-b2b-mvp`. Prace wyłącznie w repozytorium i środowisku lokalnym.
Nie logowano się na VPS; nie zmieniano main, domeny ani DNS.

## G1 — audyt i uzupełnienie pakietu

HEAD był zgodny z podanym punktem wyjścia, katalog roboczy czysty. Nie znaleziono
zakończonego raportu ani commita etapu F. Istnieje zatrzymany, oddzielny projekt
testowy F; nie uruchamiano go ponownie i nie usuwano jego wolumenu. Wynik A–E
11/11 dotyczy prezentacji z fikcyjnymi DTO, nie integracji nowych dashboardów.
Historyczna rzeczywista regresja sprzed A–E pozostaje opisana osobno.

Szkic `deploy/staging/` odwoływał się do nieistniejących generatora i migratora.
Uzupełniono przygotowanie prywatnej konfiguracji, PKI i sekretów oraz migrator
z kontrolą historii i sum plików. Compose publikuje wyłącznie lokalny port HTTPS;
PostgreSQL, GoTrue, Mailpit i API nie mają portów hosta. Brama wymaga dodatkowego
hasła testera. Nie używa się `npm run demo` ani lokalnych kont właściciela.

Naprawiono odczyt hasła bramy bez końcowego znaku nowej linii: Caddy CLI zwracał
EOF. Hasło nadal jest podawane przez stdin, bez argumentów procesu i logowania.
Migracje i nowe loginy nie są wykonywane podczas samego przygotowania plików.

Kontrole G1: generator **6/6**, migrator **7/7** (jednostkowe, bez bazy),
rzeczywiste przygotowanie nowego katalogu testowego oraz ponowna weryfikacja,
`docker compose config --quiet`, składnia Node/shell i `git diff --check` — PASS.
Są to kontrole pakietu, nie testy integracji. Początkowy błąd jednej fikstury
testu URL poprawiono; końcowy komplet migratora 7/7 zaliczony.

Wyniki kolejnych kontroli zostaną dopisane po rzeczywistym wykonaniu.
Pakiet nie jest jeszcze deklaracją gotowości do obsługi rzeczywistych firm.

## G2 — zabezpieczenia i odzyskiwanie

Dodano hostowe polecenia `staging:ops` do obsługi wyłącznie wskazanego projektu
w lokalnym kontekście Dockera. Restart/stop nie usuwają wolumenów. Aktualizacja
wymaga wcześniejszej kopii bazy i konfiguracji; historia migracji jest sprawdzana.
Pierwszy OWNER otrzymuje uprawnienia oddzielnym narzędziem DBA dla potwierdzonego
konta, bez tworzenia hasła lub pomijania MFA. Runtime nadal nie ma DBA.

Backup obejmuje PostgreSQL (w tym Auth, MFA, sesje, ACL i właścicieli obiektów),
sekrety i certyfikaty konfiguracji. AES-256-GCM uwierzytelnia archiwum przed
ekstrakcją; klucz odzyskiwania jest osobnym plikiem 0600. Trzeba przenieść go
oddzielnie offline. Odtworzenie dopuszcza wyłącznie nowy projekt bez wolumenów
i pustą bazę; nie ma przywracania przez nadpisanie istniejącej instalacji.
Wewnętrzna rola polityk NOLOGIN jest tworzona również przy bootstrapie, aby nie
usuwać własności/ACL podczas pełnego odtworzenia. Przechwycone wiadomości Mailpit
nie są trwałym kanałem pocztowym ani częścią backupu; kolejka kontaktu jest w DB.

Usunięto hasła z argumentów procesu psql, dodano filtr URI/nagłówków w logach
bramy. Naprawiono przekroczenie limitu CN OpenSSL przez długą nazwę projektu.
Generator zachowuje istniejące konfiguracje; nowy szablon dotyczy nowych zestawów.

Kontrole G2: szyfrowanie/odmowa złego klucza, uszkodzeń, nieznanych ścieżek,
symlinków i niebezpiecznych uprawnień — **6/6**; konfiguracja portów/kontekstu
budowania (w tym długa nazwa projektu) — **2/2**. Składnia i diff — PASS.
Rzeczywiste `caddy validate` z wygenerowanymi certyfikatami i filtrem logów — PASS.
Backup zapisuje również SHA źródła i identyfikatory obrazów. Bezpieczne cofnięcie
polega na odtworzeniu w nowym projekcie, nie na downgrade bazy na miejscu.
To nadal kontrole pakietu; pełne pg_dump/pg_restore i kontenery wymagają G3.
