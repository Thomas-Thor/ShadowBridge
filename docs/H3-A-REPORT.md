# H3-A — model weryfikacji przedsiębiorstw

Zakres: wyłącznie fundament PostgreSQL Sentinel. Punkt wznowienia:
`ffc836514d9d96e1da5921d3593e7648d8ad7d36`. Wyniki kontroli opisano poniżej;
historyczne przygotowanie opisuje [H3-A-CHECKPOINT.md](H3-A-CHECKPOINT.md).

## Implementacja

Migracja `202610210015_sentinel_verification.sql` dodaje:

- `company_verifications`: niezależny stan weryfikacji przedsiębiorstwa
  (`declared`, `in_review`, `verified`, `rejected`, `inactive`). Brak rekordu
  oznacza brak przeprowadzonej weryfikacji, a nie firmę zweryfikowaną.
- `verification_cases`: sprawy powiązane z firmą i opcjonalnie źródłową aplikacją;
  statusy `open`, `in_review`, `needs_information`, `completed`, `archived`.
  Jedna firma może mieć wielu członków, lecz najwyżej jedną aktywną sprawę.
- `verification_checks`: dopisywane dowody, wyniki, źródło, wykonawca, czas
  kontroli i zapisu oraz wersja procedury. Dowód to odwołanie z opcjonalną sumą
  SHA-256, nie nowy magazyn dokumentów lub danych kontrahenta.
- `verification_case_events`: niezmienna historia otwarcia, kontroli i decyzji.

Trzy funkcje bazy umożliwiają uprawnionemu personelowi otwarcie sprawy,
zapisanie **ręcznej** kontroli i udokumentowanie decyzji. Nie są nowymi
endpointami HTTP. Otwarcie aktywnej sprawy jest idempotentne; blokada firmy
porządkuje zapisy, a wersja sprawy chroni przed decyzją na nieaktualnych danych.
Zamknięta sprawa pozostaje w historii; kolejna kontrola wymaga nowej sprawy.

Stan `verified` dotyczy udokumentowanego potwierdzenia tożsamości firmy.
Wymaga najnowszego pozytywnego dowodu `company_identity` w danej sprawie.
Nie potwierdza prawa aplikanta do reprezentacji lub sprzedaży towaru, nie
zatwierdza konta, aplikacji, oferty ani członkostwa. Kontrola `representation`
pozostaje odrębna. Błąd rejestru lub wynik niejednoznaczny nie oznacza oszustwa.
Archiwizacja kolejnej sprawy zachowuje dotychczasowy stan i dowód firmy.

## Uprawnienia i granice

Wszystkie cztery tabele mają FORCE RLS. Odczyt wymaga jednocześnie
`sentinel.read`, `companies.read`, `counterparties.read` oraz aktywnego,
potwierdzonego konta pracownika z MFA. Decyzje wymagają dodatkowo
`sentinel.review`, a dowody `sentinel.checks.record`. Powiązanie źródłowej
aplikacji wymaga `applications.read` i zgodnej firmy oraz potwierdzonego
adresu e-mail aplikanta.

OWNER zachowuje dotychczasową nadrzędną kontrolę. Pozostałe role nie otrzymują
nowych praw automatycznie; trzeba je jawnie nadać. Rola API nie może bezpośrednio
wstawiać, zmieniać ani usuwać rekordów Sentinel. Funkcje sprawdzają uprawnienia
również po uzyskaniu blokady; historia i dowody mają dodatkowe blokady zmian.
Audyt ogólny zachowuje identyfikatory i statusy bez kopiowania opisów dowodów.

Przyszła rola procesu `shadowbridge_sentinel` ma NOLOGIN, NOINHERIT i nie otrzymuje
dostępu do tabel, funkcji, Auth, sesji, ról lub CRM. Istniejąca wcześniej rola
o tej nazwie zatrzymuje migrację do wyjaśnienia przez administratora; migracja
nie przejmuje jej ani nie zmienia jej uprawnień. Proces wykonawczy nie działa.

Nie ma automatycznego zakładania spraw ani przepisywania istniejących kont,
firm, aplikacji i członkostw. OWNER VAULT nie jest odczytywany, importowany,
indeksowany ani udostępniany Sentinelowi. Nie dodano panelu, kolejki zadań,
wywołań rejestru, reguł automatycznych, AI ani analityki członków.

## Rzeczywiste wyniki — 21.10.2026

Wykorzystano zachowany, oznaczony fixture z fikcyjnymi kontami i bazą 001–014.
Nie powtarzano trzech zakończonych grup przygotowania z checkpointu. Nowa
regresja trwała 23 sekundy i zakończyła się PASS: 14 zapisanych kontroli,
w tym cztery podgrupy SQL i ich kontrola zbiorcza. Nie są to 14 niezależnych
scenariuszy przeglądarkowych.

| Kontrola | Wynik |
|---|---|
| Historia 001–014 i wyłącznie fikcyjne konta | PASS; checksumy zgodne z repozytorium |
| Kolizja istniejącej roli procesu | PASS; bezpieczna odmowa i pełny ROLLBACK |
| Cała migracja i funkcje w transakcji próbnej | PASS; po ROLLBACK zachowana baza 014 |
| Rzeczywisty migrator PostgreSQL 17/TLS | PASS; 14 → 15, jedna migracja zastosowana |
| Powtórne uruchomienie migratora | PASS; 15 znanych migracji, zero nowych zapisów |
| RLS i funkcje Sentinel | PASS; cztery grupy opisane poniżej, zapisy testowe wycofane |
| Zachowane ciasteczka i rzeczywiste API/GoTrue | PASS; Buyer, Partner, współpracownik firmy, oczekujący Supplier i siedem ról pracowniczych |
| Ponowne logowanie fikcyjnego OWNER | PASS; to samo hasło, obowiązkowe MFA, dostęp dopiero po prawidłowym TOTP |
| CSRF i wylogowanie nowej sesji | PASS; odmowa bez CSRF zachowuje sesję, poprawne wylogowanie ją usuwa |
| Loader i walidacja migracji bez bazy | 7/7 PASS; oddzielne testy jednostkowe |

Cztery grupy SQL obejmują: otwieranie spraw, zgodność i potwierdzenie źródłowej
aplikacji oraz wielu członków firmy; wszystkie siedem ról pracowniczych i role
kontrahentów, MFA, jawne delegowanie i brak dostępu przy niepełnych prawach;
wyniki kontroli, najnowszy negatywny dowód, nieaktualną wersję, decyzje człowieka
oraz brak automatycznego członkostwa; niezmienność historii, audyt, FORCE RLS,
odmowę bezpośredniego zapisu i izolację roli procesu od Auth i fikcyjnego zasobu
prywatnego. Ten ostatni zasób jest testowym canary, nie rzeczywistym OWNER VAULT.

Funkcje Sentinel sprawdzano bezpośrednio w PostgreSQL z kontekstem roli API;
nie mockowano wyników SQL. Osobno rzeczywiste API i GoTrue sprawdziły istniejące
sesje, izolację uprawnień i nowe logowanie z MFA. Nowych tras HTTP ani interfejsu
Sentinel w H3-A nie ma. Kody `not_found`, `invalid_number`, `unavailable` i pozostałe
wyniki sprawdzono jako stany i ograniczenia decyzji, bez połączenia z rejestrem.

Bezpośrednio przed i po migracji oraz powtórnym uruchomieniu porównano zawartość
kont i rekordów haseł Auth, firm, aplikacji, profili, członkostw, sesji aplikacji
i Auth, tokenów odświeżania, czynników MFA, grantów i uprawnień pracowników.
Pozostały identyczne. Późniejsze normalne logowanie i wylogowanie wykonują
oczekiwane zapisy sesyjne; nie przedstawiamy ich jako operacji bez zapisu.

Przed aktualizacją wykonano prywatny `pg_dump` fikcyjnej bazy (403750 bajtów,
prawa 0600). Backup, dane dostępowe i fingerprinty pozostają poza repozytorium.
Po testach zatrzymano tylko izolowany fixture, zachowując jego kontenery i
wolumeny. Pierwotny lokalny projekt właściciela nadal działa; nie wykonywano na
nim SQL, migracji lub resetów. Nie zmieniano `.local/` właściciela.

Próby wstępne ujawniły dwa błędne oczekiwania harnessu: SQLSTATE niezgodnej
aplikacji i liczbę podgrup. Poprawiono test, zanim zastosowano migrację. Nie
wykryto usterki SQL wymagającej zmiany migracji po jej zastosowaniu.
Zaktualizowano też kontrolę liczby źródeł migracji w testach H2-C i loadera.

Powtarzalny harness: `tests/h3-sentinel-schema.integration.mjs`. Wymaga jawnego,
oznaczonego fixture z fikcyjnymi kontami, zachowanego prywatnego stanu oraz
zaufania jego testowemu CA. Odmawia pracy na zwykłej instalacji właściciela.
Opcje oddzielają próbę z ROLLBACK, trwałą migrację izolowanego fixture i testy
rzeczywistego logowania. Zanonimizowany wynik zapisano w
[JSON regresji](H3-A-RESULTS.json).

Nie powtarzano pełnych H2-A/H2-B ani regresji przeglądarkowej desktop/mobile:
kod aplikacji i interfejs nie zmieniły się. Ich poprzednie wyniki pozostają
historyczne w [raporcie H2-C](H2-C-REPORT.md). Nie testowano budowania nowego
obrazu, wdrożenia na Contabo, odtwarzania tego backupu ani zewnętrznej poczty.
Nie wysłano rzeczywistych e-maili i nie wywoływano urzędowych rejestrów lub AI.

## Dalsze etapy

[Roadmapa](SENTINEL-ROADMAP.md) zachowuje osobne H3-B, H3-C, H3-D oraz H3-E.
Ich funkcje nie są aktywne. H3-A nie oznacza gotowości całej platformy do
produkcji. Nie zmieniano Contabo, OWNER Vincent, `main`, produkcji ani DNS.
Po raporcie końcowym praca zatrzymuje się na punkcie kontrolnym.
