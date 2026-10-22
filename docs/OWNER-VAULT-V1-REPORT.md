# OWNER VAULT V1 — raport pierwszego etapu

22.10.2026. Audyt i backlog zapisano wcześniej w commicie `896e059` na
`feature/secure-b2b-mvp`. Nie zmieniano produkcji, `main`, DNS, sekretów,
konta Vincenta, jego MFA ani istniejącego prywatnego CRM.

## Co wykonano

- Migracja 016: osobny schemat `owner_vault`, firmy, osoby, klucze tożsamości,
  zgłoszenia, mapowanie przyszłych agentów i prywatny audyt.
- API OWNER: zapis, listy/szczegóły, wyszukiwanie, statusy, paginacja, ręczna
  weryfikacja z wersją i uzasadnieniem oraz prawdziwe liczniki z oknem Europe/Oslo.
  Nie zmieniono dotychczasowego Overview ani publicznego interfejsu.
- Ochrona w API i PostgreSQL: OWNER + MFA, świeże MFA dla zmian, CSRF, FORCE RLS,
  brak surowego dostępu do tabel nawet dla roli API; brak dostępu innych ról,
  Sentinela i jego roli policy. Audyt odczytów/odmów i klas błędów API.
- Wieloetapowa deduplikacja bez dopasowania po samym nazwisku; wspólne skrzynki
  nie są identyfikatorem osoby. Konflikty trafiają do ręcznego przeglądu i nie
  nadpisują danych. Idempotencja i blokada transakcyjna chronią ponowienia/wyścigi.
- Nieaktywowany kontrakt SQL dla przyszłego zapisu przez agenta: powiązanie
  principalu ze źródłem, tylko losowy receipt, bez list i wyników dopasowania,
  limit 60 nowych zgłoszeń/5 minut/agenta. Brak kont lub tokenów integracyjnych.
- Istniejąca procedura odtworzenia kopii rozpoznaje VAULT i przygotowuje jego
  role NOLOGIN przed pg_restore; kontrola zachowania danych obejmuje tabele VAULT.

## Rzeczywiste wyniki

**9 grup integracyjnych PostgreSQL 17 + GoTrue + BFF — PASS:**

1. Osobne fikcyjne konta wszystkich siedmiu ról pracowniczych, rzeczywiste MFA;
   zatwierdzone firmy Buyer/Supplier/Partner, normalne logowanie GoTrue.
2. Backup przed zmianą, bezpieczna odmowa przy kolizji roli, migracja 015→016
   i porównanie kont, zapisów haseł, sesji aplikacji/Auth, tokenów, MFA, ról i firm.
3. HTTP: brak sesji 401, wszystkie pozostałe role 403, OWNER bez MFA 403,
   OWNER z MFA 200, odmowa bez CSRF i prywatny audyt odmów.
4. Zbieżne nazwiska, wspólne skrzynki, błędnie oznaczona skrzynka `sales`,
   ten sam e-mail w innej firmie, nowy klucz źródła, konflikt profilu/e-maila
   i zmienione dane pod tym samym źródłem. Brak automatycznego nadpisania.
5. Paginacja i wyszukiwanie, limit odpowiedzi, jawna decyzja OWNER, nieaktualna
   wersja, niezmienność historii, prywatny zapis błędów po rollback.
6. FORCE RLS i ACL osobno: czasowe, wycofane nadanie SELECT do testu samego RLS;
   brak danych dla Director, brak surowego odczytu w normalnych ACL dla OWNER,
   izolacja Sentinel/policy/Auth/sessions i odmowa przy nieświeżym MFA.
7. Dedykowany fikcyjny agent bez odczytu, ograniczenie źródła, próba podszycia
   claims pod OWNER, idempotencja, równoczesne zapisy, limit i wyłączenie agenta.
8. Liczniki i granice nocy Europe/Oslo, przed 08:00, obie zmiany czasu (13/15 h).
9. Brak danych CRM w Overview i ogólnym audycie pracowników; zachowane sesje
   wszystkich kont i ten sam zweryfikowany czynnik MFA OWNER.

**2 grupy odtwarzania — PASS:** utworzenie wyłącznie znanych ról NOLOGIN w nowym
pustym celu, odmowa kolizji/niepustej bazy, pełny pg_dump/pg_restore; zgodne
fingerprinty wszystkich tabel VAULT i `sb` oraz krytycznych tabel Auth, FORCE RLS,
właściciele funkcji i ograniczenia ACL. Nie odtwarzano niczego na bazie źródłowej.
Nie testowano logowania na odtworzonym stacku ani całej otoczki szyfrowania kopii;
badano rzeczywisty dump i odtworzenie PostgreSQL. Klucze/backupy nie trafiły do Git.

**32 różne testy jednostkowe/kontrole kodu — PASS:** walidacja VAULT 5,
loader migracji 7, odzyskiwanie ról VAULT 4, dotychczasowy recovery Sentinel 4,
no-mail/runtime 3, istniejące kontrole instalatora 9. Te testy nie są testami
działającego PostgreSQL; odróżniamy je od powyższych 11 grup integracyjnych.

Wyniki maszynowe i sumy testowanych źródeł:
[OWNER-VAULT-V1-RESULTS.json](OWNER-VAULT-V1-RESULTS.json).
Harnessy: `tests/owner-vault.integration.mjs` oraz
`tests/owner-vault-restore.integration.mjs` (drugi przyjmuje wyłącznie jawny,
zakończony fixture pierwszego). Każdy tworzy/używa wyłącznie oznaczonych danych
fikcyjnych. Kontenery testowe zatrzymano, wolumeny zachowano.

Próby przygotowania ujawniły prawa 0600 do publicznego skryptu bootstrap oraz
wyczerpaną domyślną pulę sieci Docker. Poprawiono harness: kopia skryptu testowego
0644, prywatne pliki nadal 0600; dedykowana mała podsieć z kontrolą kolizji Docker.
Nie usuwano starych sieci, kontenerów ani wolumenów. Działające kontenery
pierwotnego lokalnego projektu właściciela zachowały identyczne ID.

## Granice i następny checkpoint

Nie wykonano nowej budowy obrazu, testów wizualnych lub wdrożenia Contabo.
Transport testowy był wyłącznie loopback HTTP; nie jest to test publicznego TLS.
Konta fixture założono administracyjnie w odrębnej bazie testowej z fikcyjnymi
potwierdzonymi e-mailami. Nie badano rejestracji e-mail: obecny tryb bez SMTP
ma ją wyłączoną i ta reguła pozostała zachowana. Nie wysłano żadnych wiadomości.
Nie stosowano migracji do pierwotnej lokalnej bazy właściciela.

Następny osobny etap V2: prywatny interfejs CRM, cztery klikalne kafelki,
edycja/wzbogacanie, obsługa rozstrzygnięcia konfliktów i kontrolowany proces
retencji/usuwania. Agenty, maszynowy gateway HTTPS i prawdziwy import pozostają
w V3. Przed importem potrzebna decyzja OWNER o źródłach, retencji i podstawie
przetwarzania danych; nie aktywowano niczego zewnętrznego lub płatnego.

Control Room C.A.R.T.E.L., upload/redakcja materiałów, edytor blokowy,
Umami/Sentinel/Luisa pozostają osobnymi etapami w
[uporządkowanym backlogu](MASTER-DEVELOPMENT-BACKLOG.md). Publiczna `/cartel/`
i symbol oka pozostały bez zmian. Sentinel H3-B–H3-E nie są ukończone.
Po tym raporcie zatrzymujemy się na punkcie kontrolnym V1.
