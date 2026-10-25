# Command Book: minimalny adapter MCP READ ONLY

Stan 25.10.2026: **przygotowany i przetestowany lokalnie, NIE WDROŻONY**.
OWNER przekazał wynik odbioru produkcji `236e04b`: API włączone, ChatGPT
niepołączony. Ta zmiana nie modyfikuje tego wydania ani działającej instalacji.

## Kontrakt

Planowany endpoint po osobno zatwierdzonej aktualizacji:
`https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp`.
Transport: bezstanowy MCP Streamable HTTP, odpowiedzi JSON, bez SSE/session ID.
POST wymaga `Accept: application/json, text/event-stream` i JSON-RPC 2.0.
Negocjowane wersje: `2025-06-18`, `2025-03-26`; brak zgodności klienta oznacza
STOP. GET/DELETE zwracają 405. Nie podłączać starego REST `/entries` jako MCP.

Jedno narzędzie: `read_notes({page?: integer, q?: string})`, strona do 25
niearchiwalnych notatek własnego OWNER. Nie udostępnia innych rodzajów, CRM,
kluczy, haseł, importu ani zapisu. Treści są niezaufanymi danymi referencyjnymi,
nie instrukcjami dla narzędzi. Nie zmienia istniejącego REST ani UI.

Bearer jest sprawdzany przez istniejące `owner_book.token_rpc` w ograniczonej
puli sesji. Pozostają aktywny OWNER, zweryfikowany e-mail/TOTP, data ważności,
cofnięcie klucza, zakres `note.read`, audyt i limit 60 żądań/minutę. MCP nie
przechowuje kopii tokenu, nie przekazuje go do zewnętrznego serwera i nie daje
sesji OWNER. Cookie i Origin są odrzucane. Nie otwieramy CORS.

Handshake, ping i lista narzędzi także wymagają ważnego `note.read`. Korzystają
z kontrolnego odczytu stałego UUID `00000000-0000-0000-0000-000000000000` przez
istniejące RPC; spodziewane 404 potwierdza przejście autoryzacji. Odpowiedź tego
odczytu nigdy nie jest udostępniana. Taki kontrolny brak rekordu trafia do audytu
`get / note / denied_or_error` i zużywa limit; sam nie oznacza ataku. Nie dodano
osobnego grantowania dostępu, tabel ani migracji. Właściwe wywołanie narzędzia
wykonuje jeden autoryzowany `list / note` i jest rejestrowane normalnie.

## Aktywacja i sekret: nadal wymagane

Wymagane są obie flagi: istniejąca `OWNER_BOOK_API_ENABLED=true` oraz nowa,
**domyślnie wyłączona** `OWNER_BOOK_MCP_ENABLED=true`. W tym etapie nie zmieniono
Compose, fingerprintów, prywatnych profili, skryptów aktywnego wydania ani
Contabo. Obecny instalator z `236e04b` nie wdraża tego adaptera. Nie używać go
ponownie jako procedury instalacji MCP i nie włączać flag ręcznie z pominięciem
manifestów. Kolejny krok techniczny to przejrzana aktualizacja samej aplikacji
z nowym niezmiennym SHA, backupem, zgodnym planem profilu i rollbackiem do
`236e04b`; żadnych migracji. Nie została jeszcze przygotowana ani wykonana.

OWNER zgłosił obsługę Streamable HTTP i API key/Bearer w Plugin Creator.
**Nie potwierdzono w tej sesji narzędzia create_plugin, importu pluginu ani
bezpiecznego miejsca przechowywania Bearera.** Nie wygenerowano i nie pobrano
klucza. Nie umieszczać go w paczce, URL, pliku publicznym, kodzie Sites ani
rozmowie. Przed użyciem należy sprawdzić prywatne pole Authentication i to,
że sekret pozostaje poza modelem/eksportem pluginu/logami. Jeśli narzędzie nie
zapewnia tego mechanizmu, integracja pozostaje zablokowana.

Odbiór po zatwierdzonym wdrożeniu i potwierdzeniu magazynu sekretu: OWNER tworzy
fikcyjną notatkę `TEST-CONNECTION-NOTE`, wydaje klucz 1 dzień, READ ONLY z samym
`note.read`, wprowadza go wyłącznie w prywatnym Authentication. Plugin negocjuje
MCP, widzi dokładnie `read_notes`, odczytuje tę samą notatkę/ID i odpowiada 401 po
cofnięciu klucza. Dopiero ten test oznacza połączenie READ ONLY. Zapis wymaga
odrębnego etapu i zgody. Adapter nie udostępnia nawet zapisu przy szerszym kluczu.

## Rzeczywiste wyniki testów

`node --test server/tests/owner-book-mcp.test.mjs server/tests/owner-book-assistant.test.mjs`

8 nowych grup MCP: rzeczywisty lokalny HTTP/Node, handshake/ping/notifications,
jedna lista narzędzi i odczyt strony, odmowy/wycofany klucz, zakresy, dwie flagi,
Cookie/Origin, wersje/Accept, GET/DELETE, błędny JSON, blokada zapisów/innych
zasobów, 429, ukrywanie szczegółów błędu bazy. 4 istniejące testy REST asystenta
przeszły jako celowana regresja. **SQL jest kontrolowaną fiksturą**; nie jest to
test rzeczywistego PostgreSQL, MFA/GoTrue, oficjalnego SDK klienta MCP, Plugin
Creator ani produkcji. Historycznych testów SQL 018 nie powtarzano bez zmian.
Pierwszy przebieg zatrzymał się na zbyt krótkim fikcyjnym haśle konfiguracji
testowej; poprawiono fiksturę, bez osłabiania walidacji produkcyjnej.
