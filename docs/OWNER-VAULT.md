# OWNER VAULT — fundament V1

Interfejs i addytywne API V2 opisano w [OWNER-VAULT-V2.md](OWNER-VAULT-V2.md).
Historia i wyniki V1 poniżej pozostają opisem tego wcześniejszego checkpointu.

Stan: implementacja w repozytorium, **bez wdrożenia i bez importu danych Vincenta**.
Migracja `202610220016_owner_vault.sql` dodaje osobny prywatny schemat w PostgreSQL
istniejącej platformy. To izolacja logiczna i uprawnienia, nie osobny serwer ani
zaszyfrowanie danych przed administratorem bazy. Dostęp infrastrukturalny DBA i
klucze kopii muszą pozostać ograniczone do zaufanych operatorów OWNER.

## Dane i granice dostępu

| Tabela `owner_vault.*` | Przeznaczenie |
|---|---|
| `companies` | Firma, kraj ISO alpha-2, deklarowany numer rejestrowy, branża, witryna; początkowo `unconfirmed` |
| `contacts` | Osoba i firma, stanowisko, służbowy e-mail i rodzaj skrzynki, profil zawodowy, źródło, agent/dodający, daty, wersja i status |
| `identity_keys` | Klucze źródłowe, profile zawodowe i indywidualny e-mail powiązany z firmą; nie nazwisko |
| `intakes` | Niezmienne przyjęte payloady, idempotencja, dopasowania wymagające przeglądu i dowody ręcznych kontroli |
| `agents` | Mapowanie przyszłego loginu DB na jednego agenta i system źródłowy; migracja nie tworzy aktywnego agenta |
| `events` | Prywatny, niezmienny audyt operacji, odczytów, odmów API i klas błędów; bez kopiowania nazwisk/e-maili |

Nie ma powiązania z katalogiem `sb.companies`, aplikacjami lub członkostwami
C.A.R.T.E.L. Kontakt CRM nie jest automatycznie użytkownikiem lub zatwierdzonym
kontrahentem. Potwierdzenie kontaktu nie potwierdza firmy i nie nadaje jej dostępu.

Każda tabela ma FORCE RLS. Rola API nie ma bezpośredniego SELECT/INSERT/UPDATE
na tabelach. Dostęp prowadzi przez audytowane funkcje SECURITY DEFINER, których
właścicielem jest osobna rola NOLOGIN/NOBYPASSRLS, bez członkostw i bez prawa
tworzenia obiektów. Funkcje i API sprawdzają rzeczywistą aktywną rolę OWNER oraz
MFA; zapis i decyzja wymagają także świeżego MFA z ostatnich 5 minut. Standardowe
sesje, uwierzytelnianie, CSRF i ograniczenie żądań są ponownie wykorzystywane.
Zarząd, managerowie, analitycy, kontrahenci i Sentinel nie otrzymują dostępu.

## Rozpoznawanie tożsamości

1. Dokładny `source.system + source.recordId`.
2. Dokładny kanoniczny profil zawodowy HTTPS.
3. Indywidualny służbowy e-mail **w tej samej firmie**, gdy świadomie oznaczono
   skrzynkę jako `individual`; znane skrzynki ogólne typu `info`/`sales` są wyłączone.
4. Sprzeczne klucze lub zmiana danych osoby/firmy przy dopasowanym kluczu trafiają
   do `review_required`. Nie nadpisują istniejącego kontaktu.

Samo imię i nazwisko nie wyszukuje kandydata. Wspólny/nieokreślony e-mail nie
identyfikuje osoby. Firmy łączone są wyłącznie przez dokładny kraj + deklarowany
numer rejestrowy; bez numeru powstaje osobny niepotwierdzony rekord. To reguły
ostrożne: mogą pozostawić duplikaty do ręcznego przeglądu, zamiast łączyć ludzi
na podstawie słabych poszlak. Ten etap nie prowadzi weryfikacji w rejestrach.

Ponowienie identycznego `requestKey` i payloadu zwraca ten sam losowy receipt;
zmieniony payload z tym kluczem jest odrzucany. Blokada transakcyjna i unikalne
klucze zabezpieczają wyścigi. Duplikat nie nadpisuje oryginału; zostawia historię.

## Obecne API — wyłącznie istniejąca sesja OWNER

| Metoda / ścieżka | Wynik |
|---|---|
| `GET /api/owner/vault/statistics` | Prawdziwe liczniki kontaktów, firm, zapobieżonych duplikatów, kolejki przeglądu i rekordów nocnych |
| `GET /api/owner/vault/contacts`, `/companies`, `/intakes`, `/events` | Audytowane listy; `page`, `limit` do 50, `q` i `status` tam, gdzie dotyczą rekordu |
| `GET /api/owner/vault/contacts/:uuid` | Szczegóły kontaktu i firmy; brak rekordu zwraca pustą listę, także audytowaną |
| `POST /api/owner/vault/contacts` | `{requestKey: UUID, record: {company, contact, source}}`; świeże MFA, CSRF; receipt zgłoszenia |
| `POST /api/owner/vault/contacts/:uuid/review` | `{status, version, reason}`; decyzja z uzasadnieniem, kontrola wersji i świeże MFA |

Schemat wejścia i dozwolone pola: `server/owner-vault.mjs`. Klient nie ustawia
agenta, autora, dat, ID kontaktu, praw dostępu ani statusu w pierwszym zgłoszeniu.
URL nie są pobierane przez serwer; nie przyjmujemy skryptów, poświadczeń, query
ani fragmentów w źródłowych URL. Odpowiedzi API mają `no-store`.

„Overnight” to ostatni **zakończony** przedział 18:00 dnia poprzedniego–08:00 dnia
końcowego w Europe/Oslo. Przed 08:00 pokazuje poprzednią zakończoną noc. Początek
wliczany, koniec wyłączony; podczas zmiany czasu przedział ma 13 lub 15 godzin.
API zwraca również oba końce i strefę. Kafelki Overview/UI CRM powstaną w V2;
obecny Overview i publiczna strona nie zostały zmienione.

## Kontrakt przyszłych integracji

`owner_vault.ingest(jsonb,uuid)` jest dostępny tylko dla przyszłej grupy
`shadowbridge_vault_ingest`, teraz NOLOGIN. Dedykowany login agenta musi być
powiązany z aktywnym rekordem `agents` i konkretnym systemem źródłowym przez
`session_user`. Nie wystarcza przesłanie cudzego `agentId` lub ustawienie claims.
Funkcja zwraca **tylko losowy receipt**, bez list, dopasowanych ID, liczników lub
informacji, czy kontakt już istniał. Limit: 60 nowych zgłoszeń/5 minut/agenta;
idempotentne ponowienie nie powiększa liczników. SQL powtarza walidację payloadu.

Nie otwarto połączeń PostgreSQL dla n8n/Apollo/Clay. Nie utworzono tokenów,
loginów integracyjnych ani publicznego endpointu maszynowego. V3 doda oddzielny
gateway HTTPS z per-agent scope `vault:intake`, hashowanymi/rotowanymi tokenami,
limitami rozmiaru i częstotliwości, outboxem błędów i identyfikatorem zadania.
Gateway użyje dedykowanego principalu bazy, nigdy roli API/DBA ani sesji OWNER.
Surowe błędy SQL nie trafią do agentów. Błędy SQL bezpośredniego zapisu wycofują
transakcję; trwały audyt nieudanych prób integracji wymaga gatewaya V3. Obecnie
trwały audyt klas błędów działa dla API OWNER, w osobnej transakcji po rollback.

Przed rzeczywistym pozyskiwaniem kontaktów OWNER zatwierdza źródła i ich warunki,
cel/podstawę przetwarzania, obowiązki informacyjne, usuwanie/sprostowanie danych,
umowy z dostawcami oraz retencję. Propozycja do decyzji: niepotwierdzone intakes
90 dni, techniczne błędy 30 dni, audyt 12 miesięcy; nie wdrożono jeszcze jobów
retencji. Niezmienność historii w V1 oznacza brak zwykłego kasowania przez API;
procedura uprawnionego usunięcia/anonimizacji musi powstać przed prawdziwym importem.
Nie wysyłamy danych do modeli AI ani usług wzbogacania w tym etapie.

## Migracje i kopie

016 nie zmienia istniejących kont, grantów, haseł, sesji ani MFA; niczego nie
importuje. Kolizja z istniejącym schematem lub zarezerwowaną rolą zatrzymuje
migrację z rollback, zamiast przejmować prywatne dane. Już zastosowanych migracji
001–015 nie zmieniono. Baza właściciela i Contabo nie otrzymały migracji 016.

Istniejący backup obejmuje cały dump PostgreSQL, w tym VAULT. Odtwarzanie do
nowego pustego celu rozpoznaje schemat w katalogu uwierzytelnionego archiwum
i tworzy dwie role NOLOGIN przed przywróceniem właścicieli funkcji. Starsze kopie
nie tworzą tych ról, aby nie blokować późniejszej migracji 016. Kontrola zachowania
danych przy aktualizacji uwzględnia teraz także wszystkie tabele VAULT.
Klucze, backupy i dane testowe pozostają poza Git; nie utworzono nowej usługi.

Szczegółowe wyniki i granice testów: [OWNER-VAULT-V1-REPORT.md](OWNER-VAULT-V1-REPORT.md).
