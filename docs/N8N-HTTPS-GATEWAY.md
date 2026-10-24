# n8n — osobna poprawka HTTPS Gateway

> **Dla International R1: dokument historyczny, nie bieżąca instrukcja.**
> Jedyną procedurą jest [INTERNATIONAL-R1-DEPLOYMENT](INTERNATIONAL-R1-DEPLOYMENT.md),
> zaczynająca się od odczytu Contabo bez zmiany checkoutu. Nie wykonywać poniższych
> starych poleceń deploy/gateway jako sposobu aktualizacji R1.


Stan 22.10.2026: przygotowana i przetestowana lokalnie, **bez wdrożenia Contabo**.
Gałąź `fix/n8n-https-gateway` powstała bezpośrednio z produkcyjnego
`7f794a298713d820af033ba2174cd60bfaa81e4b`. Nie zawiera migracji OWNER VAULT 016,
zmian aplikacji lub nowych funkcji CRM. Nie łączyć jej z gałęzią MVP przed
oddzielną decyzją o aktualizacji aplikacji.

## Co zmieni operator

- Doda `https://automation.shadow-bridge.eu` do istniejącej bramy Caddy:
  standardowe automatyczne HTTPS/ACME, przekierowanie HTTP, reverse proxy na
  `shadowbridge-automation-n8n-1:5678`, WebSocket i zwykłe logowanie n8n.
- Utrwali podłączenie **wyłącznie Caddy** do istniejącej sieci
  `shadowbridge-edge` (`external: true`; sieć musi już mieć `internal=true`).
- Odtworzy tylko kontener `gateway`, z tym samym przypiętym obrazem i istniejącymi
  wolumenami `/data` i `/config`. Z uwagi na `admin off` będzie krótka przerwa
  bramy; nie jest to gorący reload. Caddy zapisze nowy certyfikat w swoim
  istniejącym magazynie; nie zmienia kluczy aplikacji, MFA lub n8n.

Nie uruchomi ani nie przebuduje aplikacji, migratora, PostgreSQL, GoTrue lub n8n.
Nie wykona SQL, resetu danych, zmiany DNS lub publikacji portu 5678.
Uwierzytelnianie n8n pozostaje jego własnym istniejącym systemem kont — nie
nadaje praw OWNER/CRM. Uwierzytelnianie webhooków ustala się w samych workflow.

## Manifest i bezpieczny stan

Oryginalne pliki `.local/contabo-private/production-no-mail/7f794a2…/` pozostają
niezmienione, łącznie z `manifest.json`, `Caddyfile`, `.env` i `proxy-token`.
Pełny SHA aplikacji nadal wynosi **7f794a2…**; nowy commit dotyczy tylko bramy.

Nowy katalog `.local/contabo-private/automation-gateway/` zawiera:

- `Caddyfile` z dokładną kopią oryginału i osobnym blokiem automatyzacji;
- `compose.override.json`: tylko zmieniony mount Caddyfile i sieć bramy;
- `manifest.json`: fingerprinty nowych plików, oryginalnego manifestu produkcji,
  manifestu prywatnego, bazowego Compose i entrypointu; projekt i wersja bazowa;
- `state.json`: `prepared → applying → active` lub `rolled_back / rollback_failed`;
- `checkpoints/…`: poprzedni Caddyfile, manifest, Compose oraz fingerprint
  identyfikatorów/obrazów/mountów kontenerów chronionych przed zmianą.

Wszystkie pliki są 0600, katalogi 0700. Nie ma kopii haseł w logach/Git.
Aktywny overlay jest odczytywany przez `checkProduction()` i standardowy builder
poleceń Compose, więc późniejsze odtworzenie bramy tą ścieżką zachowuje sieć.
Nieukończony stan blokuje zwykłą obsługę profilu do czasu rollback.
Polecenia tej poprawki odmawiają pracy na wersji aplikacji innej niż 7f794a2,
przy zmianach kodu poza listą plików bramy lub przy niezgodnych fingerprintach.

## Instrukcja operatora — wyłącznie SERWER CONTABO

Konto: `shadowadmin`, polecenia wymagające Docker/plików root przez `sudo`.
Nie uruchamiać tutaj `production:deploy`, `staging:ops update`, `npm run demo`,
migratora, `docker compose down`, `down -v` ani `prune`.
**Nie pobierać aktualnej gałęzi `feature/secure-b2b-mvp` do wdrożenia.**

### 1. Pobranie tylko gałęzi infrastruktury

W istniejącym repozytorium; najpierw czysty stan śledzonych plików:

```sh
cd /opt/shadowbridge
sudo git status --short
sudo git fetch origin fix/n8n-https-gateway
sudo git switch --detach origin/fix/n8n-https-gateway
sudo node scripts/n8n-gateway.mjs check --dir=.local/contabo-private
```

Oczekiwane: `preflight: true`, `productionRelease: 7f794a2…`, `changed: false`.
Przy lokalnych zmianach śledzonych plików **zatrzymaj się**, zachowaj je, nie
używaj reset/clean/force. Nieśledzone dokumenty nie są usuwane. Pobranie kodu
i `check` nie odtwarzają żadnego kontenera. Można bezpiecznie zakończyć ten krok.

`check` wymaga: działającej starej aplikacji, oryginalnych manifestów, bramy
na przypiętym obrazie, n8n w prywatnej sieci, host portów tylko na localhost
i poprawnych publicznych adresów n8n. Nie wyświetla sekretów z Docker inspect.

Jeżeli zgłosi brak ustawień n8n, nie wykonuj `apply`. W **istniejącej** konfiguracji
n8n trzeba zachować wszystkie dotychczasowe zmienne, poświadczenia, obraz,
wolumeny, bazę, klucz szyfrowania oraz sieci i ustawić tylko publiczne adresy:

```yaml
N8N_HOST: automation.shadow-bridge.eu
N8N_PROTOCOL: https
N8N_PROXY_HOPS: "1"
N8N_WEBHOOK_URL: https://automation.shadow-bridge.eu/
N8N_EDITOR_BASE_URL: https://automation.shadow-bridge.eu
N8N_SECURE_COOKIE: "true"
```

Od n8n 2.35.0 używamy `N8N_WEBHOOK_URL` zamiast przestarzałego `WEBHOOK_URL`.
Kontrola wymaga nowej nazwy; sama stara zmienna nie spełnia warunku. Jeśli obecna
konfiguracja już zawiera poprawne `N8N_WEBHOOK_URL`, nie trzeba jej zmieniać.

To nie jest zamiennik całego pliku environment. Przed zmianą operator zachowuje
kopię istniejącej konfiguracji automatyzacji oraz jej danych. Jeżeli wymaga ona
odtworzenia n8n, najpierw deklaruje też w jego **własnym** Compose istniejącą
zewnętrzną sieć `shadowbridge-edge`, zachowując wszystkie dotychczasowe sieci.
W przeciwnym razie ręczne podłączenie n8n zniknie przy odtworzeniu. Ta poprawka
nie modyfikuje ani nie odtwarza n8n. Po przygotowaniu n8n ponów samo `check`.

### 2. Aktualizacja wyłącznie bramy

Dopiero po osobnej decyzji właściciela o wdrożeniu:

```sh
sudo node scripts/n8n-gateway.mjs apply --dir=.local/contabo-private
```

Oczekiwane: `https: true`, `n8nHealth: true`, `signInPage: true`,
`mainRelease: 7f794a2…`, identyfikator `checkpoint`.
Operacja używa wspólnej blokady produkcyjnej, sprawdza rzeczywisty merge Compose,
waliduje Caddyfile i gotowość upstreamu przed zmianą. Jedynym poleceniem `up` jest
`up -d --no-deps --no-build --pull never gateway`. Zachowuje obraz oraz wolumeny,
sprawdza niezmienność ID/mountów pozostałych usług i czeka na publiczny HTTPS.
Brak poprawnej walidacji uruchamia rollback bramy. Nie wyłączać terminala w tym
kroku; po przerwaniu nie kasować pliku blokady ani stanu bez sprawdzenia procesu.

Jeżeli ACME/HTTPS nie przejdą, nie omijaj weryfikacji certyfikatu i nie wystawiaj
5678 na `0.0.0.0`. Operator sprawdza lokalnie logi Caddy oraz dostępność istniejących
80/443 i rekordów DNS/CAA. Narzędzie niczego w DNS ani firewallu nie poprawia samo.

### 3. Odbiór i rollback

```sh
sudo node scripts/n8n-gateway.mjs verify --dir=.local/contabo-private
```

Otwórz `https://automation.shadow-bridge.eu/signin`, zaloguj się istniejącym
kontem administratora n8n i sprawdź edytor oraz połączenie push/WebSocket.
Sprawdź adres generowanego webhooka bez uruchamiania workflow wysyłającego dane.
Otwórz też `https://shadow-bridge.eu`. Automatyczny check nie loguje się za właściciela
ani nie wykonuje workflow, rejestracji lub operacji CRM.

Wycofanie samej bramy, wciąż na gałęzi tej poprawki:

```sh
sudo node scripts/n8n-gateway.mjs rollback --dir=.local/contabo-private
```

Oczekiwane `rolledBack: true`. Przywraca oryginalny mount konfiguracji i tę samą
wersję Caddy; odtwarza wcześniejsze ręczne podłączenie edge, jeśli istniało,
sprawdza HTTPS głównej domeny. Usuwa obsługę proxy n8n, nie usuwa certyfikatów,
DNS, danych, sekretów ani wolumenów. Nie cofa prawidłowych zmian w workflow.
Jeżeli inne kontenery zostały zmienione od checkpointu lub rollback nie przejdzie,
zatrzymuje się do kontroli operatora; nie wykonuje resetu bazy. Stan
`rollback_failed` oraz checkpoint należy zachować.

## Testy wykonane lokalnie

Poprawka `N8N_WEBHOOK_URL`: ponownie wykonano **7/7** testów
`node --test tests/n8n-gateway.test.mjs` oraz kontrolę składni skryptu.
Nowy scenariusz obejmuje poprawny URL z końcowym `/` i bez niego, brak nowej
zmiennej mimo obecności starej oraz pusty/błędny adres nowej zmiennej.
Poniższe wyniki pełnego pakietu pochodzą z commita `f7715b8`; nie powtarzano
testów Caddy/TLS, ponieważ ta poprawka zmienia wyłącznie walidację środowiska.

- **30/30** testów jednostkowych/kontroli plików: 6 nowych oraz 24 istniejące
  testy profilu i operacji produkcyjnych. Obejmują odmowę migracji/app changes,
  ochronę fingerprintów, portów, sekretów, stanu i przebieg rollback po błędzie.
- **6/6** grup z prawdziwym Caddy/Docker Compose: merge produkcyjnego overlay,
  walidacja produkcyjnego Caddyfile, lokalny TLS i przekierowanie HTTP, nagłówki
  oraz sesyjne Cookie/Authorization, WebSocket 101, restart i rollback.
  Zachowane wolumeny Caddy i ID fikcyjnego upstreamu.
- Upstream był fikcyjnym serwerem protokołu Node, **nie prawdziwym n8n**.
  Lokalny TLS używał jawnego testowego CA z weryfikacją certyfikatu.
  Publiczny ACME, prawdziwe konto n8n, workflow i Contabo: **NIEPRZETESTOWANE**.
  Nie zmieniono istniejących lokalnych kontenerów ani produkcji.

Wyniki: [N8N-HTTPS-GATEWAY-RESULTS.json](N8N-HTTPS-GATEWAY-RESULTS.json).
Próby wstępne poprawiły kontrolę opcji bind w merge Compose oraz testowy proxy
środowiska chmurowego i założenie o kodzie HTTP nieobsługiwanego hosta.
Nie naprawiano tych kwestii przez osłabienie HTTPS lub fingerprintów.
