# OAuth supersedes the connection step

This file records the earlier 236e04b → 35c41f7 MCP installation. For the next
update on an already accepted 35c41f7 installation use
[OWNER-BOOK-MCP-OAUTH.md](OWNER-BOOK-MCP-OAUTH.md). Do not rerun this older rollout.

# Kontrolowana aktualizacja MCP z przyjętego R1 236e04b

25.10.2026. Implementacja instalatora jest gotowa w tej gałęzi i przetestowana
lokalnie. Nie wykonano nowego wdrożenia ani backupu produkcji z tej sesji.
Baza: 236e04bded81c406fb49ee0950ae20d139f257ec, z odbiorem potwierdzonym przez OWNER.
Adapter wywodzi się z 45ed3ee; bieżące wydanie dodaje scoped odczyt operacyjny.
Kandydat do instalacji to pełny niezmienny SHA z najnowszego raportu, nie 45ed3ee.

## Jedna procedura na lokalnym Pop!_OS

Pobrać `scripts/r1-owner-deploy.mjs` z podanego pełnego SHA, sprawdzić SHA-256
z raportu i uruchomić `node <zweryfikowany plik> --release=<pełny SHA> --book-mcp`.
Potrzebne Node >=22, dotychczasowe SSH/sudo shadowadmin i sprawdzony host Contabo.
Sekretów nie umieszczać w komendach, rozmowie, repozytorium ani logach.
Instalator nie potrzebuje klucza Book, nie prosi o nowy OWNER ani reset MFA.

Kolejność jest automatyczna z niezbędnymi potwierdzeniami operatora:

1. OWNER loguje się normalnie i potwierdza dotychczasowe TOTP. Każdy zachowany
   operation.lock zatrzymuje bootstrap zamiast przerywać działającą aktualizację.
   Sprawdzany jest dokładny kandydat Git; bez force, resetów i zmian main.
2. Nowa samodzielna diagnostyka sprawdza działający 236e04b (67 plików z
   niezmiennego obiektu Git), API=true i MCP=false, komplet 001–018, profile,
   gateway, TLS/n8n, sieci, prywatne porty, OWNER/TOTP i wolne miejsce.
   Wymagany stary checkpoint DEPLOYED_AND_VERIFIED z osobistym odbiorem OWNER;
   nie wywołuje ponownie jego accept. Każda rozbieżność oznacza STOP.
3. Budowany jest tylko runtime. Nowy plan zachowuje REST=true, poprzedni obraz
   i jego kompletny override, aktywne manifesty i fingerprinty. Dopuszcza tylko
   nowy obraz, RELEASE_SHA i osobno zatwierdzoną flagę MCP. Nie modyfikuje
   gatewaya, Auth, bazy, sieci, wolumenów ani sekretów.
4. W krótkim oknie app/Auth oraz Caddy wykonywane są istniejące zaszyfrowane
   kopie DB/config/certyfikatów. Weryfikacja GCM i SHA oraz kopia poza VPS są
   obowiązkowe przed wymianą aplikacji. Kopia konfiguracji obejmuje aktywne
   plany d5582ff/236e04b, nowy plan i prywatny snapshot starego odbioru.
   Nie kopiuje się produkcyjnej bazy do Codexa lub repozytorium.
5. Faza apply pomija budowanie i uruchamianie migratora. Stabilny snapshot
   i ledger są kontrolowane, a wymieniana jest wyłącznie app (--no-deps,
   --no-build). Następnie HTTPS, SHA/obraz, ledger, chronione usługi i odmowy
   anonimowe REST/MCP. Istniejące n8n i jego workflow nie są modyfikowane.
6. OWNER potwierdza TOTP po aktualizacji (np. ponownym logowaniem w UI), a następnie
   odbiera Book, REST i witrynę. Odbiór wymaga nowego zdarzenia MFA po apply. Wpis ODBIOR
   zatwierdza nową generację; ROLLBACK cofa samą aplikację bez odtwarzania starej
   DB. Wynik MCP_ENABLED_CHATGPT_NOT_CONNECTED nie oznacza jeszcze połączenia.

Po przerwaniu na DEPLOYED_PENDING_OWNER_ACCEPTANCE użyć tego samego sprawdzonego
instalatora z `--book-mcp --accept-only`. Ten tryb wykonuje tylko nowy accept,
bez prepare/apply, kopiowania backupów i ponownego deploymentu. Przy innym
checkpoincie zatrzyma się. Nie kasować plików lock ani nadpisywać checkpointów.

## Wyłączenie i rollback

`--book-mcp --disable` wyłącza tylko MCP, zachowując REST=true i dane. Obraz musi
należeć do tej samej generacji i przejść kontrolę planu. Nowy mcp-disabled.json
jest hashowany/zweryfikowany, nie jest ręczną edycją prywatnych plików.

Awaria apply uruchamia istniejący rollback aplikacji do poprzedniego obrazu
236e04b i jego API=true. Zachowuje ledger 001–018, nowe dane i backupy. Odbiór
może też jawnie wybrać ROLLBACK. Żadnego compose down -v, prune, resetu lub
przywracania starej DB na produkcję. Weryfikowane są HTTPS i chronione usługi.

## Odbiór prywatnego połączenia i importu

Pole Authentication i brak sekretu w paczce/modelu/JS/logach muszą być
potwierdzone przez rzeczywistą integrację. Potem pierwszy test tylko note.read,
1 dzień. Nie podłączać REST /entries jako MCP. Nie używać book_admin.

Tymczasowy zapis do importu: istniejące API/GUI, minimalne CUSTOM obejmujące
wyłącznie potrzebne read/write + records.import. Dopiero po odczycie obecnego
Book, porównaniu source_ref/treści, podglądzie zatwierdzonym przez OWNER i kopii.
Powtórzenie używa tego samego klucza i UUID polecenia dla tego samego payloadu;
po niepewnym wyniku nie tworzyć nowego UUID lub klucza. Po rotacji klucza trzeba
najpierw ponownie porównać source_ref z Book, bo deduplikacja komend jest per-key.
Nie ma nowej globalnej unikalności source_ref ani niezależnego importera.

Po imporcie odczytać ID i treść. OWNER cofa klucz tymczasowy w UI z MFA; stare
read/write mają zwrócić 401, odrębny READ ONLY nadal działa. Tego produkcyjnego
importu i cofnięcia nie wykonano; scenariusz przeszedł w izolowanym PostgreSQL.
Raporty przyszłych agentów wymagają odrębnego reports-only principal. Obecne
klucze Book należą do aktywnego OWNER; nie podsuwamy takiego klucza jako konta
technicznego z prawem tylko do raportów. Ten ograniczony principal jest później.

## Wyniki i ograniczenia

25 celowanych testów aktualizatora/R1: PASS, w tym rzeczywiste Compose config,
GCM, niezmienne source hashes, MCP-off z REST=true, rollback i kopia starego
odbioru. 11 HTTP MCP + 4 REST: PASS. 6 grup native image + TLS PostgreSQL: PASS.
To fikcyjne dane, SQL claims OWNER/MFA ustawione jawnie na nowym klonie; brak
interaktywnego GoTrue/Plugin Creator/Contabo. Konta i MFA źródłowej fikstury
pozostały bez zmian. SQL 001–018 nie został zmieniony. Nie używać historycznego
instalatora z samego 236e04b do instalacji nowego MCP.
