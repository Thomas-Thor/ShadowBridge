# Checkpoint wykonania: Book i kontrolowana aktualizacja MCP

25.10.2026. **Kod i opisane testy lokalne wykonano. Nowego wdrożenia Contabo,
połączenia ChatGPT i importu do produkcyjnego Book nie wykonano.**

## Wykonane

- Commit 54dc7ac: obsługa przyjętej bazy 236e04b, 67 niezmiennych plików obrazu,
  REST=true/MCP=false przed aktualizacją, 001–018 i pełne wcześniejsze zabezpieczenia.
- Nowy tryb --book-mcp buduje tylko runtime, zachowuje REST, wymaga zaszyfrowanych
  kopii i potwierdzonej kopii poza VPS, pomija migrator, wymienia tylko app.
  MCP-off zachowuje REST; rollback nie cofa bazy i wraca do obrazu/override 236e04b.
- Kopia konfiguracji zawiera wcześniejsze aktywne plany i prywatny snapshot
  istniejącego odbioru. Ten odbiór nie jest ponawiany lub nadpisywany.
- Lock innego wydania oznacza STOP, nie usuwanie locka/przerywanie procesu.
  --accept-only wznawia tylko odbiór nowej generacji, bez prepare/apply.
- Commit 70dd5e0: minimalny odczyt operacyjny: read_notes, read_book_entries
  (zadania/pomysły/kalendarz/decyzje) i read_activity. Każdy rodzaj wymaga własnego
  zakresu. Brak narzędzi zapisu; pierwszy klucz pozostaje note.read.
- Prywatny szkic importu: 25 kandydatów (5 zadań, 8 jawnych aktualnych decyzji,
  12 notatek, w tym archiwum i format prostego Credit Ledger). Oryginał i wcześniejszy
  szkic zachowane. Walidacja istniejącego importera przeszła, request confirm=false.
  Treści handlowych, sald kont i plików importu nie opublikowano na GitHubie.
- Archiwum zachowuje 257 punktów źródła. Nie odnaleziono odrębnego źródła rejestru
  71/12/15. Liczniki te oraz 7/1/15 pozostają historyczne. Bieżącego Book nie
  odczytano, więc szkic nie jest jeszcze listą brakujących wpisów ani deduplikacją.
- Minimalny ledger wykorzystuje istniejące notatki i historię: format pomiaru,
  źródło, jednostka, okres, koszt/waluta, workflow/agent, before/after i null dla
  braku danych. Przygotowano historyczne pomiary oraz index NO DATA, bez nowej
  tabeli, fałszywego odczytu bieżącego lub przeliczania niejasnego licznika.
- Osobna gałąź acquisition: wyłączone workflow nie zbierają telefonów; mapowanie
  telefonu blokuje request. Nie zmieniono istniejących danych kontaktowych.

Funkcja owner-book-memory-review porównuje istniejące source_ref/treść i zachowuje
wykonane zadania. Same podobne tytuły lub edycje OWNER trafiają do przeglądu.
Bez pełnego autoryzowanego odczytu z archiwum nie wyznacza brakujących rekordów.
6 testów porównania przeszło; na rzeczywistym szkicu zwróciła BLOCKED_CURRENT_BOOK_INCOMPLETE.

## Sprawdzone lokalnie

- 25 testów aktualizatora/R1: niezmienne źródła, rzeczywisty Docker Compose config
  (bez uruchamiania usług), backup GCM, fingerprinty, rollback i konfiguracja MCP-off.
- 11 HTTP MCP z fiksturą SQL + 4 regresje REST.
- 6 grup natywnego obrazu Node i rzeczywistego PostgreSQL verify-full: handshake,
  odczyt notatki, izolacja dwóch fikcyjnych OWNER, odrębne zakresy, odmowa zapisów,
  rzeczywiste wygaśnięcie/cofnięcie i audyt. Istniejący import przyjął fikcyjną
  partię raz po ponowieniu; klucz zapisu cofnięto, niezależny READ ONLY działał.
- Konta, hasła/MFA źródłowej fikstury i nowego klonu pozostały bez zmian.
  SQL OWNER/MFA fixture claims są jawne, bez interaktywnego testu GoTrue.
- 20 odrębnych testów logiki sourcingu/importu nieaktywnego/ochrony kredytów po no-phone fix.
- Szkic importu: 25 rekordów, unikalne source_ref, 49 240 znaków w istniejącym
  formacie JSON UI (limit 50 000), 51 499 bajtów zwartego żądania REST (limit 65 536).

Natywny test dotyczy SHA 9192b868cba4284c15a935d24060529ced4b2af9. Budowanie obrazu
przeszło, OCI revision zgodny. Obrazy, klony, logi i backupy testowe zachowano w
izolowanej przestrzeni /tmp. Własne usługi testowe zatrzymano. Trzy wcześniejsze
lokalne kontenery właściciela pozostały uruchomione z tymi samymi ID. Migracji
001–018 nie zmieniono. Nie oznacza to testu produkcyjnych kont lub wykonania backupu VPS.

## Blokady rzeczywistego odbioru

Nie ma autoryzowanego SSH i wywoływalnych Book/Plugin Creator/Apollo/Clay/n8n
w tej sesji. Publiczne GET blokuje proxy CONNECT 403/origin 000 również poza
sandboxem; nie jest to odpowiedź Contabo. OWNER zgłasza istniejące połączenia
wtyczek; nie konfigurujemy ich ponownie i nie wnioskujemy z tego o stanie n8n.

Nie potwierdzono prywatnego pola Authentication, importu pluginu ani rzeczywistego
read_notes z ChatGPT. Opis połączenia JSON jest opisem kontraktu, nie paczką pluginu.
Nie wygenerowano klucza. Nie zapisano raportu w Book bez autoryzowanego zapisu.

Przed importem: rzeczywisty odczyt wszystkich potrzebnych rodzajów Book, porównanie
source_ref/treści, lista braków/duplikatów, zatwierdzenie podglądu przez OWNER,
backup i tymczasowe CUSTOM bez book_admin. Potem odczyt ID/treści, Revoke przez
OWNER i odmowa starych read/write przy działającym osobnym READ ONLY.
Klucza przy niepewnym wyniku nie rotować i nie zmieniać UUID; deduplikacja komend
jest per-key. Po rotacji najpierw ponownie porównać source_ref. Nie ma globalnej
unikalności source_ref i nie twierdzimy, że wykonano produkcyjne scalenie.

Automatyczny reports-only principal wymaga odrębnego ograniczonego kontraktu;
obecne klucze Book należą do aktywnego OWNER. Nie przekazujemy takiego klucza
agentom jako pozornego konta technicznego. Nie uruchomiono n8n importu, testowego
zapisu CRM, canary, harmonogramu, wysyłki lub wydatku. Aktualny właściwy odbiorca
CRM, prawa, limity i koszt źródeł wymagają odczytu. Nie zastępujemy Google Sheets
lub istniejącego CRM drugą bazą.

## Jeden najbliższy krok operatora

Uruchom na lokalnym Linuxie zweryfikowany instalator z pełnego SHA raportu:
`node <plik> --release=<pełny SHA> --book-mcp`. Procedura i awaryjne wyłączenie:
[OWNER-BOOK-MCP-UPDATE-PLAN.md](OWNER-BOOK-MCP-UPDATE-PLAN.md).
Wynik MCP_ENABLED_CHATGPT_NOT_CONNECTED potwierdza tylko etap aplikacji i bramki;
nie dowodzi autoryzowanego odczytu ChatGPT. Nie ponawiać starego --book-api 236e04b.
