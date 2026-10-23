# International R1 — procedura operatora do zatwierdzenia

**NIE URUCHAMIAĆ TERAZ.** R1 nie ma jeszcze zgody na wdrożenie. Najpierw zamknąć
BLOCKER z [raportu gotowości](INTERNATIONAL-R1-READINESS.md). Nie wykonano poniższej
procedury na Contabo ani pełnego ćwiczenia wymiany/rollbacku obrazów. Test kodu
rollbacku i jego granice opisano w [raporcie testów](INTERNATIONAL-R1-TESTS.md).

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

W odrębnym izolowanym celu trzeba wcześniej potwierdzić pełny produkcyjny build,
Compose, TLS, migracje i rollback obrazów oraz odzyskanie obu archiwów i trwałych
danych Caddy. Nie odzyskiwać niczego do działającej bazy. Zachować poprzednie
obrazy przez ich niezmienne ID, certyfikaty/wolumeny Caddy i konfigurację n8n;
nie wykonywać `prune`, `down`, usuwania wolumenów lub kontenerów. Klucze backupu
przechowywać oddzielnie od archiwów, również poza serwerem. Zaplanować krótką
niedostępność aplikacji; automation/Caddy pozostają uruchomione.

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
```

Oczekiwane: dwa archiwa AES-256-GCM (DB + prywatna konfiguracja i osobno publiczny
profil + gateway), osobne klucze i `PASS` snapshotu. Brak haseł/rekordów w logu.
DB, Caddy, n8n i wolumeny działają dalej. Stary wrapper backupu nie wznowi Auth/app,
ponieważ były już zatrzymane przed jego wywołaniem. Jeśli kopia nie powiedzie się:
**nie stosować migracji**; `"${C[@]}" start auth app` wznawia poprzednie kontenery.
Nie usuwać nieudanej kopii lub plików diagnostycznych; nie odtwarzać kopii na źródło.

Backup konfiguracji R1 uzupełnia stary backup; nie zastępuje zabezpieczenia
trwałych wolumenów TLS Caddy. Ich osobna kopia i odtworzenie wymagają zamknięcia
BLOCKER przed tym oknem. Nie wysyłać żadnych archiwów, kluczy ani inspect do GitHub/czatu.

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

Planowanie, porównania Compose i szyfrowanie konfiguracji przetestowano. Rollback
kodu z działającą DB i sesjami również. **Powyższy pełny przebieg obrazów na
produkcyjnym Compose jest nadal NIEPRZETESTOWANY** i dlatego R1 nie ma statusu
gotowego do zatwierdzenia. Dokument opisuje docelową procedurę do przeglądu,
nie polecenie jej wykonania ani deklarację ukończenia wdrożenia.
