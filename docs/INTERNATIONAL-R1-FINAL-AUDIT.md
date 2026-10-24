# International R1 — końcowy audyt 24.10.2026

**READY FOR PREFLIGHT. Nie zatwierdzono bezpośredniego wdrożenia.**
Start audytu: 9a34bab9a12238ae935e70eaf961f75a8a2ae338. Bez SSH, zmian Contabo,
kont, MFA, DNS, main, migracji ani uruchamiania instalatorów.

## Co rzeczywiście wiadomo

| Element | Dowód i ograniczenie |
| --- | --- |
| Prywatny staging i oddzielny publiczny Caddy | Opisane w historii instalacji; /opt/shadowbridge-public było osobną bramą. Brak aktualnego odczytu serwera |
| Produkcja 7f794a2 | Wskazana przez OWNER. Nie stanowi dowodu istnienia konkretnego no-mail profilu i jego aktywacji |
| Gateway 9a64cc0 | Przygotowany i testowany lokalnie. Potwierdzono wcześniej ręczne podłączenia do shadowbridge-edge, ale nie wdrożenie manifestów/state active |
| Repo, runtime, profil | To trzy różne tożsamości. Git HEAD nie dowodzi obrazu aplikacji ani faktycznie zamontowanego Caddyfile |
| R1 | Zachowane: 4 buildy, 6 grup prawdziwego stosu, rollback obrazów, restore 71 tabel i 13 plików Caddy, zgodność 64 plików runtime |

**Wniosek:** R1 wymienia samą aplikację w już poprawnie aktywowanej produkcji
no-mail 7f794a2 z fingerprintowanym gatewayem. Nie zamienia automatycznie starego
stagingu i osobnego Caddy w ten układ. Jeżeli taki starszy/ręczny układ nadal
działa, potrzebny jest wcześniejszy, osobno zatwierdzony etap zgodności na
podstawie inwentaryzacji. Nie można bezpiecznie wybrać go bez danych z serwera.

## Co sprawdzi operator — bez modyfikowania instalacji

Samodzielny skrypt uruchomiony z /tmp odczytuje:

- Git HEAD i liczbę zmian, running/stopped kontenery, obrazy, release i 61
  checksumów runtime bazowej wersji; nie wypisuje Env ani sekretów.
- Zgodność aktywnego Env z zapisanym profilem (bez ujawniania wartości),
  prywatne TLS Auth, zastane projekty/źródła konfiguracji, manifesty i fingerprinty, zamontowany
  Caddyfile, stan gatewaya, sieć internal oraz prywatne porty.
- Ledger 001–017 i liczbę aktywnych OWNER z potwierdzonym e-mailem i TOTP
  w transakcjach READ ONLY. Bez identyfikatorów, e-maili, haseł lub sekretów MFA.
- Obie domeny, DNS, zaufane TLS/certyfikaty, GET /health, /healthz i /signin.
- Zastane wolumeny, liczbę kopii oraz miejsce/inody rzeczywistego Docker data-root.
  Nie potwierdza kopii poza VPS, pełnego restore lub osobistego logowania OWNER.

Wymagane przed aktualizacją: zaakceptowana inwentaryzacja, głęboki preflight,
osobista próba OWNER+TOTP, zaplanowane świeże kopie/oddzielne klucze/offsite,
znany poprzedni immutable image, zgodny ledger i osobna zgoda na okno.
Wynik BLOCKED oznacza zatrzymanie, bez generowania brakujących profili na ślepo.

## Naprawy i bieżące testy

Usunięto próbne POST ze ścieżki `preflight`. Pozostają GET i SELECT; standardowe
testy zamkniętych endpointów po wdrożeniu pozostają w osobnym `verify`.
Ujednolicono warunek aktywnego OWNER, zgodności e-maila i istniejącego TOTP.
Dodano standalone inventory i budżet dysku/inodów dla przyszłych ciężkich testów.

**29 różnych celowanych przypadków PASS**: 13 nowych oraz 16 istniejących.
Podzbiory powtórzone po poprawkach nie są doliczane. Testy obejmują klasyfikację
legacy/manual, odmowę złego SHA/ledgeru/TLS/portów, prywatność raportu, rzeczywiste
pliki fikcyjnych profili, źródłowe hashe, GET-only oraz warunki braku miejsca.
Odpowiedzi HTTP tych testów są syntetyczne. Nie powtarzano pełnych testów backendu,
buildów, MFA lub odtwarzania; ich niezmienione runtime ma zachowane wyniki.

Narzędzie odzyskania samego hasła jest niezmienione względem 7f794a2. Ma rzeczywisty
test z 22.10 na fikcyjnym GoTrue; nie uruchamiano go teraz. Wymaga oddzielnego
incydentu i zgody, backupu oraz niezależnej weryfikacji osoby. Zachowuje MFA/role,
kończy tylko sesje danego OWNER. Utrata TOTP nie jest rozwiązana resetem hasła.

## Miejsce w Codexie

/ i /workspace to ten sam overlay ~32 GB; pozostało około 138 MB. /tmp to odrębny
tmpfs ~17 GB. Początkowo zajmował ~14 GB, a zwykłe du nie widziało rootowych
cache demona. Kontrolowany odczyt wykazał ~12,6 GB zbędnego VFS cache i ~2,2 GB
zachowanego overlay2 z fikcyjnymi bazami/wolumenami.

Z zatrzymanego, własnego VFS data-root usunięto tylko image/vfs/buildkit/containerd
cache po potwierdzeniu **zero kontenerów i zero wolumenów** w tym data-root.
Oddzielne overlay2 z bazami, wszystkie backupy i kontenery pozostawiono. Usunięto
także własny cache pobrań npm; nie zwiększyło to faktycznego wolnego miejsca /,
więc nie zaliczamy tego jako odzyskaną pojemność root. Nie wykonano prune/reset/clean.

/tmp ma teraz ~15 GB i ponad 4 mln wolnych inodów. Ciężki test z /workspace lub
domyślnego Dockera pozostaje **zablokowany**. Nowe fixture checkouty, backupy,
cache i Docker muszą być w /tmp, z osobnym overlay2. Guard wymaga 8 GiB budżetu,
2 GiB rezerwy, co najmniej 200 tys. inodów puli, 128 MiB/10 tys. inodów root na
metadane oraz limitu użycia tmpfs 12 GiB; sprawdza to przed startem i każdą nową
fazą testu. Nie wznowiono ciężkich testów. Git i checkpointy pozostają w repo.

## Jedna procedura

Obowiązuje wyłącznie [INTERNATIONAL-R1-DEPLOYMENT](INTERNATIONAL-R1-DEPLOYMENT.md),
od etapu 0 **przed checkoutem**. Starsze instrukcje oznaczono jako historyczne.
Po raporcie operatora podejmiemy decyzję o zgodności; teraz niczego nie wdrażać.

SMTP i publiczna rejestracja/reset, operacyjne przeglądy aplikacji, polityki
prywatności/retencji i bezpieczne pliki ofert należą do późniejszego go-live.
Publiczna giełda/Market nie jest częścią International R1.
Szczegóły maszynowe: [FINAL-AUDIT.json](INTERNATIONAL-R1-FINAL-AUDIT.json).
