# International R1 — procedura operatora do zatwierdzenia

**Pakiet lokalnie przetestowany 24.10.2026; nie wdrożono go na Contabo.**
Procedura aktualizacji wymaga zatwierdzonego okna. Można wcześniej wykonać
wyłącznie odczytowy preflight. W izolacji sprawdzono pełne obrazy, produkcyjny
Compose, migracje, rollback obrazu i odtworzenie całego stosu/certyfikatów.
Nie jest to potwierdzenie aktualnego stanu serwera ani publicznego ACME.

Wszystkie poniższe polecenia: **SERWER CONTABO, konto `shadowadmin`, przez sudo**,
w Bash. Nie wykonywać na lokalnym komputerze właściciela. Nie ma tu operacji DNS,
zakupu usług, uruchamiania demo lub tworzenia kont. Nie używać pełnego
`production:deploy`, prywatnego `staging:ops update` ani `n8n-gateway apply` z R1.
Ich wcześniejsze ograniczenia pozostają celowo aktywne.

## 0. Zanim rozpocznie się okno

Operator potwierdza rzeczywisty projekt, katalog `.local`, historię migracji,
niezmieniony aktywny profil gatewaya i wolumeny. OWNER sam sprawdza istniejące
logowanie i MFA. Nie przypisujemy roli na podstawie imienia. Jeśli gateway nie
ma aktywnego fingerprintowanego profilu 9a64cc0 albo ma konfigurację ręczną,
**STOP** — potrzebna odrębna ocena zastanego stanu, bez przepisywania manifestów.

Pełny test izolowany został wykonany — nie trzeba go powtarzać na danych
właściciela. Zachować poprzednie obrazy po ID, certyfikaty/wolumeny Caddy oraz
konfigurację n8n. Bez `prune`, `down`, resetu bazy lub kasowania wolumenów.
Klucze backupu przechowywać oddzielnie, również poza serwerem. Okno obejmuje
zatrzymanie app/Auth oraz krótkie zatrzymanie Caddy dla spójnej kopii certyfikatów;
po tej kopii Caddy i n8n wracają przed migracją aplikacji.

## 1. Zatwierdzony checkout

```sh
cd /opt/shadowbridge
sudo git status --short
```

Oczekiwane: czysto. Przy lokalnych zmianach lub nieśledzonym dokumencie — STOP,
zabezpieczyć pracę, nie wykonywać reset/stash/usuwania. Następnie, po zgodzie:

```sh
sudo git fetch origin release/shadowbridge-international-r1
sudo git switch release/shadowbridge-international-r1
sudo git pull --ff-only origin release/shadowbridge-international-r1
R1_SHA='PEŁNY_SHA_Z_ZATWIERDZONEGO_RAPORTU_R1'
test "$(sudo git rev-parse HEAD)" = "$R1_SHA"
SB_SOURCE=/opt/shadowbridge/.local/contabo-private
```

`SB_SOURCE` ma wskazywać **rzeczywiście istniejący** katalog instalacji. Przykład
nie jest poleceniem jego utworzenia. Jeśli jest inny, zmienić tę jedną zmienną.
Przerwanie: Ctrl+C; uruchomione usługi nie zmieniły się. Powrót checkoutu do
poprzedniego SHA nie jest sam w sobie rollbackiem obrazu aplikacji.

### Odczytowa bramka przed budową i oknem

```sh
sudo node scripts/international-r1.mjs preflight --dir="$SB_SOURCE"
df -h / /var/lib/docker
```

Oczekiwane: `PASS`, `readOnly:true`, `deployed:false`. Preflight niczego nie
aktualizuje, nie uruchamia migracji i nie zmienia kont. Sprawdza profile i sieć,
prywatne porty, istniejące OWNER+potwierdzony e-mail+MFA, ledger i oba HTTPS.
Nie zastępuje osobistej próby logowania OWNER. Błąd/inna baza niż 7f794a2: STOP,
zachować wynik bez sekretów; nie naprawiać manifestów ani kont na ślepo.
Przed buildem wymagane wolne miejsce na nowe obrazy i wszystkie kopie bez
usuwania poprzednich obrazów. Oryginalny profil pozostaje kotwicą 7f794a2.

## 2. Obraz i plan — bez zatrzymywania aplikacji

```sh
sudo docker build --target runtime --build-arg SHADOWBRIDGE_RELEASE_SHA="$R1_SHA" --tag "shadowbridge-international:r1-$R1_SHA" --file deploy/staging/Dockerfile .
R1_IMAGE="$(sudo docker image inspect --format '{{.Id}}' "shadowbridge-international:r1-$R1_SHA")"
sudo node scripts/international-r1.mjs prepare --dir="$SB_SOURCE" --release="$R1_SHA" --image="$R1_IMAGE"
R1_PLAN="$SB_SOURCE/international-r1/$R1_SHA"
sudo node scripts/international-r1.mjs check --dir="$SB_SOURCE" --plan="$R1_PLAN"
```

Oczekiwane: build i `PASS`, `deployed:false`. Plan akceptuje wyłącznie zgodną
etykietę OCI revision oraz rzeczywisty niezmienny ID obrazu. Zachowuje istniejący
obraz rollbacku; nie zmienia `.env`, selectorów, proxy tokenu ani gatewaya. Drugie
`prepare` dla tego samego katalogu bezpiecznie odmówi, zamiast go nadpisać.
Przy braku miejsca/błędzie fingerprintu — STOP; stara aplikacja nadal działa.

Zbudować istniejący migrator w tym samym projekcie, zanim rozpocznie się przerwa:

```sh
SB_PROJECT="$(sudo node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1])).project" "$R1_PLAN/plan.json")"
SB_PRODUCTION="$(sudo node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1])).productionDirectory" "$R1_PLAN/plan.json")"
C=(sudo docker --context default compose --project-name "$SB_PROJECT" --env-file "$SB_PRODUCTION/compose.env" -f deploy/production/compose.yaml -f "$SB_SOURCE/automation-gateway/compose.override.json")
"${C[@]}" build --build-arg SHADOWBRIDGE_RELEASE_SHA="$R1_SHA" migrator
```

Oczekiwane: tylko build; żadnej migracji lub odtworzenia gatewaya. Nie omijać
weryfikacji TLS, gdy registry/npm jest niedostępne. Przerwanie nie zmienia DB.

## 3. Kopie i zatrzymanie wyłącznie zapisujących usług

```sh
sudo node scripts/international-r1.mjs backup-config --dir="$SB_SOURCE" --plan="$R1_PLAN"
"${C[@]}" stop app auth
sudo node scripts/staging-ops.mjs backup --dir="$SB_SOURCE"
sudo node scripts/international-r1.mjs snapshot --dir="$SB_SOURCE" --plan="$R1_PLAN"
"${C[@]}" stop gateway
sudo node scripts/international-r1.mjs backup-edge --dir="$SB_SOURCE" --plan="$R1_PLAN"
"${C[@]}" start gateway
```

Oczekiwane: trzy archiwa AES-256-GCM (DB + prywatna konfiguracja, publiczny
profil + gateway oraz trwałe dane/certyfikaty Caddy), osobne klucze i `PASS` snapshotu. Brak haseł/rekordów w logu.
DB, n8n i wolumeny pozostają; Caddy jest krótko zatrzymany tylko dla swojej kopii. Stary wrapper backupu nie wznowi Auth/app,
ponieważ były już zatrzymane przed jego wywołaniem. Jeśli kopia nie powiedzie się:
**nie stosować migracji**; `"${C[@]}" start gateway auth app` wznawia poprzednie kontenery.
Nie usuwać nieudanej kopii lub plików diagnostycznych; nie odtwarzać kopii na źródło.

`backup-edge` wymaga zatrzymanego gatewaya, app i Auth; kopiuje tylko `/data`
i `/config` istniejącego Caddy i szyfruje je. Nie tworzy ani nie zmienia wolumenów.
Kopia zawiera klucze prywatne; nie udostępniać katalogu kopii, archiwów ani kluczy.
Przed migracją operator sprawdza utworzenie wszystkich trzech par archiwum/klucz
oraz zabezpiecza je poza VPS, z kluczami oddzielnie. Błąd backupu: bez migracji,
wznowić stare kontenery. W lokalnym teście odtworzono wszystkie trzy archiwa,
13 plików Caddy i działający stos w nowym projekcie; nigdy nie odtwarzać na źródło.

## 4. Tylko brakujące migracje, bez resetu

```sh
"${C[@]}" run --name "$SB_PROJECT-r1-migration-${R1_SHA:0:12}" --no-deps migrator
sudo node scripts/international-r1.mjs preserved --dir="$SB_SOURCE" --plan="$R1_PLAN"
```

Oczekiwane: migrator sprawdza niezmienną historię 001–017 i stosuje tylko brakujące
016/017, a potem `PASS` porównania istniejących danych Auth/sb/portal/VAULT.
Nie zmieniono dawnych SQL ani nie ma downgrade/DROP. Kontener migratora pozostaje
zachowany (bez `--rm`). Kolizja nazwy, nieznana historia lub różnica danych oznacza
STOP; nie ponawiać z inną nazwą w celu ominięcia błędu.

Przy błędzie przed uruchomieniem R1: zachować DB, backupy i diagnostykę. 016 może
być zakończona, gdy 017 się wycofa. Nie cofać bazy. Poprzedni runtime uruchamiać
tylko po potwierdzeniu kompatybilnej, zakończonej historii; nie ignorować błędu SQL.

## 5. Uruchomienie tylko nowej aplikacji

```sh
"${C[@]}" start auth
sudo "$R1_PLAN/apply-application.sh" --after-reviewed-backup-and-migrations
sudo node scripts/international-r1.mjs verify --dir="$SB_SOURCE" --plan="$R1_PLAN"
```

Oczekiwane: zmieniony tylko kontener aplikacji; wcześniejszy obraz zachowany po ID.
Skrypt wymaga świadomego potwierdzenia, ponownie sprawdza profile i przekazuje
`up --no-build --no-deps ... app`. Nie wykonuje całego `compose up` i nie odtwarza
Auth/gatewaya. Weryfikacja sprawdza rzeczywisty obraz i SHA, prywatne Auth po TLS,
strony, blokady prywatnych plików/paneli, zamknięte ścieżki mailowe i automation.
Bez SMTP oczekiwane jest **503 MAIL_NOT_ENABLED**, nie udana rejestracja.

OWNER sprawdza we własnej przeglądarce normalne logowanie, dotychczasowe MFA,
Command Center oraz VAULT. Testy zapisów tylko na wcześniej uzgodnionych fikcyjnych
rekordach. Brak dostępu OWNER — STOP i diagnoza roli, bez nadawania uprawnień.
Nie uruchamiać odzyskiwania hasła/MFA jako elementu aktualizacji.

## 6. Rollback aplikacji — bez utraty nowych danych

Po decyzji operatora w razie niepowodzenia:

```sh
sudo "$R1_PLAN/rollback-application.sh" --application-only-no-database-restore
```

Skrypt wybiera zapisany **poprzedni ID obrazu** i jego znacznik wersji, zachowuje
produkcyjny overlay gatewaya i odtwarza wyłącznie aplikację. Nie przywraca bazy,
nie cofa migracji 016/017 i nie usuwa nowych rekordów. Jeśli Auth było zatrzymane,
najpierw `"${C[@]}" start auth`. Przed ponownym uruchomieniem sprawdzić, czy nie
pozostał aktywny migrator. Jeśli profil zmienił fingerprint, skrypt bezpiecznie
odmówi — nie naprawiać manifestu na ślepo.

Stara aplikacja 7f794a2 nie ma UI/API VAULT; jego nowe dane pozostają w DB.
Późniejszy powrót do R1 używa tego samego zachowanego planu, po ponownej kontroli.
Przywracanie danych jest odrębną procedurą do nowego pustego celu, nigdy częścią
rollbacku aplikacji. Nie przełączać DNS, nie stosować `production:ops rollback`
(przywróciłby dawny prywatny gateway/Basic Auth), nie usuwać żadnych wolumenów.

## Granica potwierdzenia

Powyższy przebieg obrazów, migracji, zachowania danych, backupów i rollbacku
sprawdzono na **produkcyjnym Compose z testowym overlayem certyfikatów/portów**,
na całkowicie oddzielnym daemonie Docker. Zamiast publicznego ACME użyto lokalnej
CA; oba połączenia DB/Auth zachowały `verify-full`. Użyto rzeczywistego n8n.
Wersja runtime testowanych obrazów to faed3e4; 64 pliki runtime porównano
z aktualnym drzewem. Dalszy commit zmienia tylko hostowe narzędzia/testy/raporty,
nie runtime. Obraz instalowany na Contabo trzeba zbudować z pełnym zatwierdzonym
SHA i odpowiadającą mu etykietą OCI, czego pilnuje `prepare`.

Nie uruchomiono tej procedury na Contabo. Odczytowy preflight oraz osobista
próba OWNER są wymagane na rzeczywistej instalacji. Rejestracja/reset przez
pocztę pozostają wyłączone; nie jest to pełny go-live dla nowych użytkowników.
