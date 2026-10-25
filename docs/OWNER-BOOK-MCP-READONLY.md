# OWNER Book MCP READ ONLY

Stan 25.10.2026: kod i izolowane testy wykonane; aktualizacji Contabo i połączenia
ChatGPT w tej sesji nie wykonano. OWNER przekazał odbiór produkcji 236e04b.

Endpoint po zatwierdzonej aktualizacji:
`https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp`.
Transport `streamable-http`, POST JSON-RPC; `Content-Type: application/json`,
`Accept: application/json, text/event-stream`. Negocjacja 2025-06-18 / 2025-03-26.
Bez SSE i sesji MCP; GET/DELETE 405. To osobny endpoint od REST `/entries`.

| Narzędzie | Odczyt | Zakres |
|---|---|---|
| read_notes | notatki, raporty i prywatny rejestr kredytów zapisane w notatniku | note.read |
| read_book_entries | wskazany rodzaj: task, idea, event lub decision | odpowiednie resource.read |
| read_activity | istniejący dziennik z redakcją metadanych CRM | journal.read |

Listy do 25 pozycji ze stronicowaniem. read_notes/read_book_entries obsługują też
jawny filtr archived=false|true|all, aby historyczna pamięć nie była ukryta. Pierwszy test i klucz tylko `note.read`.
W UI wybrać READ ONLY, 1 dzień i odznaczyć inne zasoby; zostawić tylko note.read.
Nie używać istniejącego presetu CUSTOM write do pierwszego połączenia.
Inne zakresy można dodać do odrębnego klucza READ ONLY dopiero świadomie;
listing narzędzi sam nie przyznaje dostępu. Nie ma narzędzi zapisu, importu,
CRM, kont, kluczy lub haseł. Koszty/aktywność agentów bez źródła pozostają null.

Klient deklaruje `api_key`, `headerScheme: bearer`; sekret trafia wyłącznie
w Authorization. Serwer zachowuje token_rpc/RLS, aktywnego rzeczywistego OWNER,
zweryfikowane e-mail/TOTP, wygaśnięcie, cofnięcie, limit 60/min i audyt. Nie
używa sesji OWNER, nie zapisuje kopii klucza i nie pobiera nowych uprawnień.
Cookie i Origin odrzucane; CORS nie jest otwierane.

Metadane MCP sprawdzają note.read przez stały pusty UUID. Oczekiwany brak notatki
404 pochodzi z istniejącego RPC i jest rejestrowany jako get/note/denied_or_error;
to kontrola dostępu, nie dowód incydentu. Jej odpowiedź nie jest udostępniana.
Właściwy odczyt jest rejestrowany normalnie i aktualizuje last_used_at.

Potrzebne obie flagi: OWNER_BOOK_API_ENABLED=true i OWNER_BOOK_MCP_ENABLED=true.
MCP jest domyślnie wyłączone. [Procedura aktualizacji](OWNER-BOOK-MCP-UPDATE-PLAN.md)
używa nowego trybu --book-mcp; nie powtarza starego wdrożenia --book-api.

Wtyczka Plugin Creator jest zgłoszona przez OWNER jako podłączona, ale jej
narzędzia nie są wywoływalne w tej sesji. Nie potwierdzono rzeczywistego pola
Authentication, serwerowego przechowywania sekretu poza modelem/paczką/logami
ani połączenia. Nie wygenerowano klucza. Nie tworzymy pliku z tokenem, Sites JS,
nowego adaptera ani no-auth/OAuth obejścia. Ukryty monit operatora jest dozwolony
przez OWNER wyłącznie do kontrolowanych operacji istniejącego API, nie zastępuje
faktycznego połączenia ChatGPT.

Odbiór po wdrożeniu: fikcyjna notatka TEST-CONNECTION-NOTE, wprowadzenie 1-dniowego
note.read wyłącznie do zweryfikowanego prywatnego Authentication, initialize,
notifications/initialized, tools/list, read_notes i porównanie ID/treści w UI.
Po Revoke ponowny odczyt ma odmówić 401. Dopiero to potwierdza połączenie.

Testy: 11 lokalnych HTTP z kontrolowanym SQL, 4 regresje REST oraz 6 grup native
Node image + rzeczywisty TLS PostgreSQL na nowym klonie fikcyjnej bazy. Testowano
izolację OWNER, zakresy, wygaśnięcie i cofanie; istniejący import przyjął fikcyjną
partię raz po bezpiecznym ponowieniu, wycofano zapis, osobny READ ONLY pozostał
aktywny. Nie testowano interaktywnego GoTrue ani klienta Plugin Creator.
Dowody: [checkpoint](OWNER-BOOK-COMPLETION-CHECKPOINT.md).
