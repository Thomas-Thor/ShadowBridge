# R1 + OWNER Command Book: jedna procedura operatora

**Działające R1 `d5582ff` i aktywacja API:** użyć [nowej procedury Book API](OWNER-BOOK-CHATGPT-CONNECTION.md).
Poniższy przebieg dotyczy wyłącznie wcześniejszej aktualizacji z 7f794a2.

**READY FOR OWNER ACTION. Nie wykonano aktualizacji Contabo z sesji Codexa.**
Zgłoszona przez operatora produkcja: `7f794a298713d820af033ba2174cd60bfaa81e4b`.
Operator potwierdził HTTPS/HTTP 200 dla aplikacji, n8n `/healthz` i HTML `/signin`;
JSON `/signin` zwraca 404. Naprawiono nieprawidłowy nagłówek Accept diagnostyki,
również w kontrolach R1/gatewaya. TLS, status i wynik endpointu są sprawdzane
osobno. Nie zniesiono żadnego innego warunku preflightu.

Ta instrukcja zastępuje ręczny przebieg wdrażania z wcześniejszych dokumentów
R1/Book. Ich raporty testowe pozostają historycznymi dowodami. OWNER Book jest
już zintegrowany przez fast-forward z R1; nie potrzeba kolejnego merge. `main`
pozostaje nietknięty. Ostateczny **pełny SHA** i wynik budowy znajdują się w
końcowym raporcie sesji. Nie stosować ruchomego `latest` ani samych skrótów SHA.

## Jedno uruchomienie — LOKALNY POP!_OS, zwykłe konto OWNER

Wymagane są już działające Node.js >=22, curl, OpenSSH oraz dotychczasowy dostęp
`shadowadmin@169.58.232.69` z zapamiętanym i sprawdzonym kluczem hosta. Nie trzeba
przesyłać żadnego hasła, tokenu lub klucza do Codexa. Installer użyje zwykłego SSH
i może poprosić w terminalu o dotychczasowe uwierzytelnienie SSH/sudo. Nie jest to
tunel dla użytkowników aplikacji. Zostawić komputer włączony do końca procesu.

Wkleić jeden blok, podstawiając SHA z raportu (w końcowej odpowiedzi jest gotowy
blok z rzeczywistym SHA):

```bash
SB_R1_RELEASE='PEŁNY_SHA_Z_RAPORTU'
SB_R1_INSTALLER=$(mktemp /tmp/shadowbridge-r1-install.XXXXXX.mjs) &&
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/$SB_R1_RELEASE/scripts/r1-owner-deploy.mjs" \
  --output "$SB_R1_INSTALLER" &&
printf '%s  %s\n' 'a8d8baadb32266cf2ca60c46c53fd5362a9ad9a52dafa6e49e82582606343f31' "$SB_R1_INSTALLER" | sha256sum --check - &&
node "$SB_R1_INSTALLER" --release="$SB_R1_RELEASE"
```

Nie wykonywać tego bloku na VPS ani przez `curl | sh`. Najpierw pobranie i
kontrola SHA-256, potem uruchomienie. Brak znanego klucza hosta oznacza STOP;
installer nie dodaje go automatycznie ani nie wyłącza kontroli SSH/TLS.

## Co zrobi automat

1. Poprosi o osobiste sprawdzenie istniejącego logowania OWNER + TOTP w
   przeglądarce i potwierdzenie okna. Nie pyta o kod TOTP lub hasło aplikacji.
2. Wykona poprawioną diagnostykę **przed zmianą checkoutu**. Rozpozna istniejące
   profile, kontenery, prywatne porty, sieci, n8n, certyfikaty, role, ledger i
   miejsce. Weryfikuje tylko znany profil 7f794a2 + gateway 9a64cc0. Inna/nieznana
   instalacja, zmieniony fingerprint, nieczyste repo lub brak miejsca: STOP.
3. Pobierze z GitHuba dokładnie zatwierdzony commit, wykona tylko fast-forward
   gałęzi R1, sprawdzi kompletność 001–018 i wymagane przodki. Bez `main`, resetu
   lub nadpisania lokalnej pracy. Zbuduje aplikację i migrator z tym SHA, zachowa
   poprzedni obraz i przygotuje chroniony fingerprintami plan.
4. Zatrzyma app/Auth na czas spójnej kopii i aktualizacji. Krótko zatrzyma Caddy
   tylko na kopię stanu certyfikatów, następnie wznowi ten sam kontener. n8n nie
   jest zatrzymywany, konfigurowany ani importowany; w krótkiej przerwie bramy
   jego publiczny HTTPS jest niedostępny. To wymaga uzgodnionego okna operacyjnego.
5. Utworzy zaszyfrowane kopie DB + konfiguracji prywatnej, profilu produkcji i
   gatewaya oraz certyfikatów. Sprawdzi GCM, katalog `pg_restore`, hashe wszystkich
   plików konfiguracji/certyfikatów. **To nie jest odtworzenie produkcyjnej kopii**;
   pełne odtwarzanie sprawdzono wcześniej na fikcyjnej izolowanej instalacji.
6. Pobierze wszystkie trzy archiwa i klucze na komputer OWNER, sprawdzi rozmiary
   i SHA-256. Dopiero potwierdzenie tej konkretnej generacji kopii dopuszcza
   migracje. Archiwa: `~/.local/state/shadowbridge-release/<SHA>/archives/`;
   klucze osobno: `recovery-keys/`, pliki 0600, katalogi 0700. Nie publikować ich.
   Nie przenosić/usunąć tych katalogów przed zakończeniem aktualizacji. Później
   zabezpieczyć klucze w niezależnym sejfie/offline.
7. Ponownie sprawdzi manifesty i snapshot. Zastosuje tylko brakujące migracje,
   porówna wcześniejsze dane, wznowi Auth i wymieni wyłącznie aplikację.
   Stary obraz, DB, sesje, hasła, MFA, dane CRM, sieci i wolumeny pozostają.
   Dokładny runtime 7f794a2 sprawdzono na klonie po 018: 61 checksumów źródeł,
   health/config i zachowanie wszystkich wcześniejszych danych potwierdzone.
   Błąd po rozpoczęciu migracji uruchamia kontrolowany rollback aplikacji tylko
   przy poprawnym ledgerze i zakończonym migratorze; nie przywraca starej bazy.
8. Sprawdzi właściwy SHA/obraz, HTTPS, witrynę, prywatne Auth, n8n i wyłączenie
   zdalnego API. W przeglądarce OWNER wykona krótki odbiór Book/VAULT/logowania,
   izolacji i kluczy na fikcyjnych wpisach. Wybrać `ODBIOR` po sukcesie albo
   `ROLLBACK`, jeśli odbiór ujawni problem. Nowe dane nie są kasowane przy rollbacku.

Sam wynik skryptu `DEPLOYED_PENDING_OWNER_ACCEPTANCE` **nie oznacza pełnego
odbioru**. Dopiero poprawne kontrole serwera, osobiste potwierdzenie oraz nowe
odnotowane MFA uprawnionego OWNER pozwalają zakończyć `DEPLOYED_AND_VERIFIED`.
Tester nie wnioskuje roli na podstawie imienia Vincent i nie zmienia jego konta.

## STOP, przerwanie i wznowienie

Bez `down -v`, `prune`, usuwania wolumenów, resetów DB, edycji manifestów lub
powtórnych migracji. Jeden proces chroniony jest blokadą; obcy/stary lock
oznacza kontrolę operatora, nie jego automatyczne usunięcie. Zatrzymanie przed
migracjami zachowuje kopie i dotychczasową aplikację; błąd samego transferu
uruchamia anulowanie i wznowienie starych app/Auth. Awaria SSH może uniemożliwić
potwierdzenie wznowienia — wtedy wymagany operator, bez deklaracji sukcesu.

Po udanym przygotowaniu i przerwanym transferze można kontynuować wyłącznie
ten sam SHA i tę samą generację kopii, jeśli checkpoint nadal ma
`BACKUPS_VERIFIED_WAITING_OFFSITE`. Częściowe pliki nie są nadpisywane; błędny
hash zatrzymuje dalszą pracę. `PLANNED`, `MIGRATING`, `CANCELLED_BEFORE_MIGRATION`
lub utrata połączenia po zastosowaniu aplikacji wymagają odczytania zachowanego
checkpointu przez operatora. Nie uruchamiać ponownie z innym SHA, żeby obejść STOP.

Prywatny stan: `/opt/shadowbridge/.local/r1-owner-release-<SHA>/state.json`;
oryginalny plan R1, obrazy, kontener migratora, kopie i klucze są zachowane.
Do raportu dla Codexa wystarczy komunikat statusu/bezpieczny błąd, **bez** kopii,
kluczy, sekretów lub surowych logów. Po `ROLLBACK` odbiór nowej wersji nie jest
potwierdzony; wcześniejsza aplikacja działa z zachowaniem rozszerzonej bazy.

## Co pozostaje wyłączone

`OWNER_BOOK_API_ENABLED=false` jest wymuszone w planie i sprawdzane po aktualizacji.
Klucze można tworzyć, kontrolować i cofać w panelu, lecz zdalne wywołania dostają
503. Egzekwowanie zakresów/wygaśnięcia przetestowano w izolacji, bez włączania API
produkcyjnego. [Kontrakt ChatGPT](owner-book.readonly.openapi.json) jest gotowy;
zmiana flagi w kontrolowanym planie aplikacji i próbne połączenie READ ONLY
wymagają osobnego zatwierdzenia. Obecny installer nie ma opcji włączenia API.

SMTP, rejestracja/reset e-mail, globalne workflow, Apollo, Clay, Scout i import
do VAULT pozostają wyłączone. Secure Vault to punkt wejścia do zewnętrznego
Bitwarden, nie połączony sejf ani magazyn haseł w PostgreSQL. Nie jest to jeszcze
publiczne otwarcie rejestracji lub giełdy.
