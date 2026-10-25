# OWNER Book API + ChatGPT: stan i bezpieczne uruchomienie

Raport historyczny przygotowania 236e04b. OWNER później potwierdził jego odbiór.
Aktualny etap MCP: [checkpoint wykonania](OWNER-BOOK-COMPLETION-CHECKPOINT.md) i
[aktualizacja z 236e04b](OWNER-BOOK-MCP-UPDATE-PLAN.md). Nie ponawiać starego --book-api.

**Kod przygotowany i przetestowany lokalnie. Nie wdrożono tej aktualizacji i nie
połączono ChatGPT.** OWNER zgłosił działające R1 `d5582ffd9f1e7f9a40a1a49f9e16a304eae64a4e`,
logowanie/TOTP i zarządzanie kluczami. Sesja Codexa nie ma autoryzowanego SSH;
odczyty produkcji i dokumentacji OpenAI blokuje proxy CONNECT 403, także po
ponowieniu poza sandboxem. Nie jest to dowód awarii Contabo.

## Plugins / Plugin Creator i Plus: granica potwierdzenia

Główna ścieżka jest zgodna ze wskazaniem OWNER: **Plugins / Plugin Creator**.
Nie potwierdzono Developer Mode, prywatnego MCP ani Sites z MCP w tym koncie.
W katalogu narzędzi i skills tej sesji nie ma zainstalowanego Plugin Creator.
Nie możemy więc zbadać jego dokumentacji wewnętrznej, pola Authentication lub
mechanizmu potwierdzania zapisów. Nie stwierdzamy, że Plus obsługuje tę integrację
ani że wymaga wyższego planu. Żadnego planu nie kupiono. GPT Actions nie jest
głównym rozwiązaniem.

**Najbliższy krok OWNER:** udostępnić tej sesji widoczny w interfejsie Plugin
Creator przez instalację, **bez wprowadzania klucza**. Najpierw trzeba potwierdzić
wydawcę, specyfikację i poniższe możliwości. Sama opcja instalacji nie oznacza
możliwości wywołania prywatnego API.

Wymagania odbioru narzędzia:

- prywatna integracja z serwerowym przechowywaniem sekretu Bearer poza rozmową,
  modelem, kodem strony i publicznym pakietem pluginu;
- narzędzia odczytu i zapisu na domenie ShadowBridge oraz jawne potwierdzenie
  każdej zmiany przez OWNER;
- trwały UUID jednego polecenia także przy ponowieniu, obsługa wersji rekordów
  i błędów 401/403/409/429;
- możliwość cofnięcia integracji i usunięcia jej sekretu.

[Kontrakt HTTP dla integratora](owner-book.plugin.openapi.json) jest gotowy.
To **nie jest gotowy lub zaimportowany plugin**. Wymaga potwierdzenia, że Plugin
Creator przyjmuje taki kontrakt albo potrafi zbudować bezpieczny adapter.
Adnotacja `x-openai-isConsequential` opisuje wymagane potwierdzenie, ale sama nie
dowodzi, że dane narzędzie je egzekwuje. Gdy platforma tego nie potrafi, nie
udostępniać jej klucza z zapisem.

Jeżeli dostępny Plugin Creator obsługuje wyłącznie MCP, potrzebne są jego
rzeczywista specyfikacja transportu i uwierzytelniania. Nie implementowano
niepotwierdzonego adaptera MCP/OAuth ani starego `ai-plugin.json`. Sama strona
Sites nie jest bezpiecznym magazynem tokenu; nie osadzamy klucza w HTML/JS, nie
otwieramy CORS i nie obchodzimy kontroli Origin. Najprostsze rozwiązanie wybierzemy
z faktycznie dostępnych funkcji obecnego konta, bez nowego abonamentu.

Odczyty oficjalnych źródeł nie powiodły się; nie przedstawiamy ich treści jako
zweryfikowanej: [Developer mode](https://platform.openai.com/docs/guides/developer-mode),
[Apps/connectors](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt),
[MCP](https://platform.openai.com/docs/mcp). Odczyt repozytorium OpenAI przez GitHub
API również odmówiony. Brak dostępu nie jest dowodem braku funkcji w Plus.

## Przygotowany interfejs i API

Klucze: **1, 3, 7, 30, 60 dni** oraz CUSTOM z datą i godziną do **90 dni**.
Daty edytuje się w strefie urządzenia; podgląd podaje Europe/Oslo, baza przechowuje
timestamp ze strefą. PostgreSQL nadal odrzuca przeszłość i przekroczenie 90 dni.
Ważność istniejących kluczy nie została zmieniona. SINGLE USE nie dodano —
wymagałby osobnej polityki i atomowej operacji w bazie.

Przycisk **Prepare ChatGPT CUSTOM scopes** wybiera nazwę `ChatGPT Command Book`,
1 dzień i wyłącznie `task`, `note`, `idea`, `event` z `.read`/`.write`,
`journal.read` i `summary.export`. Nie wybiera `book_admin`, decyzji ani importu.
Utworzenie i Revoke wymagają świeżego MFA. Domyślny zwykły formularz nadal jest
READ ONLY. Sekret jest maskowany, ma COPY i Dismiss, znika po dwóch minutach
lub zmianie sesji. Zniknięcie z widoku nie kasuje schowka.

| Zasób | Operacja |
|---|---|
| Odczyt | `GET /entries?kind=note`, szczegół i historia według zakresu |
| Podsumowanie | `GET /export?kinds=task,note,idea,event`, do 50 wpisów |
| Dziennik | `GET /journal?window=24h`, zanonimizowane metadane bez CRM |
| Nowy wpis asystenta | `POST /assistant/entries` |
| Edycja asystenta | `PUT /assistant/entries/{id}`, z aktualną `version` |

Wszystkie ścieżki są względne do
`https://shadow-bridge.eu/api/integrations/owner-book/v1/`.
Zapis asystenta przyjmuje `{entry, requestKey, explicitWrite: true}`; UUID musi
pozostać taki sam przy ponowieniu tego samego polecenia. Zmienione ponowienie
otrzymuje 409. Adapter używa **tych samych** RPC, RLS, zakresów, blokad właściciela
i audytu. Natywne endpointy REST nadal wymagają poprzednich nagłówków polecenia.
Nie dodano ról, loginów DB ani migracji. SQL 001–018 pozostaje niezmieniony.

Dostęp maszynowy nie akceptuje cookies/Origin i nie umożliwia zarządzania
kluczami, kontami, CRM, bankami, hasłami lub agentami. Zewnętrzny dziennik usuwa
identyfikatory, działania i liczniki prywatnego CRM/security; panel OWNER zachowuje
dotychczasowy widok. Limity 60 żądań/min/klucz i 10 zapisów/min oraz audyt bez
treści/tokenów pozostają egzekwowane przez PostgreSQL.

Notatnik nie jest sejfem: OWNER nie zapisuje w jego treści haseł bankowych,
tokenów lub kluczy infrastruktury. Rozpoznawanie znanych formatów sekretów nie
wykrywa każdego hasła w zwykłym tekście. Klucz integracji daje dostęp do wybranej
treści notatnika, dlatego zakresy i prywatność dostawcy wymagają świadomego wyboru.

Download summary używa dołączonego do DOM linku, MIME `text/plain;charset=utf-8`,
opóźnionego zwolnienia Blob i natychmiastowego czyszczenia przy zmianie sesji.
Błędy wskazują istniejącą opcję Copy. Pole Reference / Source jest jawnie
opcjonalne i opisuje źródło/powiązany materiał. Nie zmieniono istniejących wpisów
ani importu/eksportu. Plik TXT rzeczywiście pobrano i porównano w Chromium/Linux.
**Branded Chrome i Firefox nie były tu uruchomione**; Firefox nie jest dostępny,
a oficjalne pobranie blokuje proxy. Po wdrożeniu odbiór obu przeglądarek polega
na kliknięciu Preview summary → Download summary i otwarciu TXT z Downloads.

## Jeden instalator aktualizacji Contabo — do uruchomienia przez OWNER

Nie uruchamiać teraz starego instalatora bez `--book-api`. Nowy tryb akceptuje
wyłącznie rozpoznane działające R1 `d5582ff`, 67 checksumów plików obrazu, pełny
ledger 001–018, zgodne profile/gateway, OWNER z TOTP, HTTPS/n8n i wolne miejsce.
Nie wystarcza HEAD checkoutu lub komunikat użytkownika.
Weryfikuje też poprzedni plan R1 i zgodność jego obrazu z kontenerem. Aktywny
override R1 oraz skrypty rollbacku są włączone do zaszyfrowanej kopii konfiguracji;
brak/zmiana tego planu zatrzymuje aktualizację, zamiast przepisywać manifesty.

Na lokalnym Pop!_OS, Node >=22, dotychczasowe SSH/sudo i sprawdzony klucz hosta:

```bash
SB_BOOK_RELEASE='PEŁNY_SHA_Z_RAPORTU'
SB_BOOK_INSTALLER=$(mktemp /tmp/shadowbridge-book-api.XXXXXX.mjs) &&
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/$SB_BOOK_RELEASE/scripts/r1-owner-deploy.mjs" \
  -o "$SB_BOOK_INSTALLER" &&
printf '%s  %s\n' '5246b80d4da349039a13df4bcbb2ba627b9f185051b1c75c1f78d17331038e1d' "$SB_BOOK_INSTALLER" | sha256sum --check - &&
node "$SB_BOOK_INSTALLER" --release="$SB_BOOK_RELEASE" --book-api
```

Automat: preflight → osobiste potwierdzenie OWNER/TOTP → build samej aplikacji →
zaszyfrowane kopie DB/config/certyfikatów i ich weryfikacja → pobranie poza VPS
z kontrolą SHA → snapshot danych → **bez uruchamiania migratora** → wymiana tylko
app i flagi API → HTTPS, obraz/SHA, ledger, chronione usługi i odmowa bez klucza.
Przerwa app/Auth i krótka przerwa Caddy dla kopii certyfikatów wymagają okna;
n8n i jego workflow nie są zmieniane. Kopie/klucze mają ścieżki jak poprzednie
wydanie R1, nowe nazwy według SHA; dane źródłowe nie są nadpisywane.

Wynik `API_ENABLED_CHATGPT_NOT_CONNECTED` nie potwierdza prywatnego odczytu lub
zapisu. Do takiego potwierdzenia potrzebny jest poniższy test przez rzeczywistą
integrację. Nie podawać tokenu instalatorowi lub terminalowi.

Awaryjne wyłączenie zewnętrznego API tym samym, zweryfikowanym instalatorem:

```bash
node "$SB_BOOK_INSTALLER" --release="$SB_BOOK_RELEASE" --book-api --disable
```

Zmienia tylko flagę i kontener app. Nie cofa kluczy, MFA lub danych, nie wymaga
przebudowy obrazu/backupów. STOP przy nieznanej aplikacji lub zmianie manifestów.
Rollback po nieudanym odbiorze wybiera poprzedni obraz R1 i API=false, nigdy starą
bazę. Zachowane są checkpointy, backupy i wolumeny; bez reset/prune/down -v.

## Rzeczywisty test po potwierdzeniu Plugin Creator

1. OWNER tworzy w panelu fikcyjną notatkę `TEST-CONNECTION-NOTE` bez danych firm.
2. Tworzy `ChatGPT Command Book`, CUSTOM, 1 dzień. Wkleja sekret **wyłącznie** do
   bezpiecznego pola Authentication zatwierdzonej prywatnej integracji.
3. ChatGPT odczytuje tę notatkę. OWNER jawnie poleca zapisać fikcyjny pomysł;
   platforma pokazuje potwierdzenie narzędzia przed POST.
4. OWNER odświeża panel: to samo ID i treść. Rejestruje się jedno wykonanie;
   bezpieczne ponowienie używa tego samego UUID i nie tworzy drugiego wpisu.
5. OWNER sprawdza last used i audyt, następnie cofa klucz. Ponowny odczyt oraz
   zapis przez tę samą integrację muszą otrzymać 401.

Dopiero ten przebieg pozwala zapisać **CONNECTED / LIVE READ AND WRITE VERIFIED**.
Natywne testy kontenera ani syntetyczna odpowiedź narzędzia tego nie zastępują.
Apollo, Clay, nocne workflow, SMTP i publiczna rejestracja pozostają wyłączone.
