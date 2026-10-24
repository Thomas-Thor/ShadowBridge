# OWNER Book API + ChatGPT: checkpoint roboczy

Baza: R1 `d5582ffd9f1e7f9a40a1a49f9e16a304eae64a4e`; rozwój na
`feature/owner-book-chatgpt-v1`. OWNER zgłasza działającą produkcję R1.

Gotowe lokalnie: okresy kluczy 1/3/7/30/60 dni i CUSTOM do 90 dni, preset CUSTOM
dla ChatGPT, maskowanie i COPY, poprawiony TXT download (link w DOM, opóźnione
zwolnienie Blob, błędy i fallback Copy), opcjonalny Reference / Source z opisem.
HTTP adapter zapisów ma jawne potwierdzenie w JSON i to samo SQL/RLS/scopes/audyt
oraz UUID idempotencji co istniejące API. Nie zmieniono migracji ani istniejących
kluczy. SINGLE USE nie dodano. 15/15 testów Node/VM/adaptera zaliczone; nie są to
testy produkcji, Firefoxa ani połączenia z ChatGPT.

Do wykonania: Chromium + rzeczywisty izolowany PostgreSQL, preflight aktualnego
R1 i kontrolowany rollout bez migracji, kontrakt integracyjny i raport. Stary
preflight 7f794a2 nie może być użyty do uznania działającego R1 za błąd.

Blokady dostępu: brak autoryzowanego SSH; proxy odmawia produkcji oraz oficjalnej
dokumentacji OpenAI (CONNECT 403, również po ponowieniu). Odczyt repo OpenAI przez
GitHub API również odmówiony. Brak Firefoxa, oficjalne pobranie odrzucone.
Nie wyłączano TLS i nie obchodzono proxy.

OWNER potwierdził Plus z opcją Plugins / Plugin Creator do instalacji, bez
potwierdzonego Developer Mode/MCP. W dostępnych narzędziach i skills tej sesji
nie ma Plugin Creator. Nie zakładamy wsparcia zapisu/MCP/Sites w Plus ani
kompatybilności nieznanego formatu pluginu. GPT Actions nie jest główną ścieżką.
Nie instalowano usług, nie aktywowano API, nie połączono ChatGPT, nie zmieniono
Contabo, kont, TOTP, DNS, n8n ani main.
