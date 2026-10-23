# OWNER VAULT V2 — prywatny CRM International

Implementacja na osobnej gałęzi `feature/owner-vault-v2`, z V1 (`6d200ee`) jako
bazą. **Bez wdrożenia na Contabo.** Publiczna witryna i C.A.R.T.E.L. bez zmian.
International pozostaje platformą prywatną/premium. Przyszły publiczny Market
i prywatna sieć C.A.R.T.E.L. nie otrzymują dostępu do tego CRM. Scout jest osobnym
pilotem sourcingowym; nie połączono go, n8n, Sentinela ani agentów z VAULT.

## Dostęp i podgląd

Po aktualizacji **odrębnej instalacji testowej** do migracji 017 zaloguj się
normalnym formularzem, potwierdź MFA i otwórz:

- `/portal/admin/` — dotychczasowy Overview oraz cztery prawdziwe kafelki OWNER;
- `/portal/admin/?module=vault` — firmy i pozostałe sekcje prywatnego CRM.

Sekcja jest widoczna wyłącznie wtedy, gdy `/api/staff/access` zwraca `owner=true`.
To nie jest zabezpieczenie danych: każde API i funkcja PostgreSQL niezależnie
sprawdzają `sb.is_owner()`. Wymaga to aktywnego, zweryfikowanego konta, aktywnego
grantu personelu, niewygasłego przypisania roli `owner` i rzeczywistego AAL2.
Imię, e-mail, nazwa „Vincent”, przesłane role i samo `staff=true` nie nadają dostępu.

**Nie sprawdzono faktycznej roli konkretnego konta właściciela na Contabo.**
Nie łączono się z tą bazą i nie zmieniano konta, hasła, ról ani MFA. Przed przyszłym
uruchomieniem właściciel/operator musi sprawdzić istniejące przypisanie; brak
OWNER to odmowa dostępu i sprawa do wyjaśnienia, nie automatyczny awans konta.

Nie otwieraj HTML bez backendu jako „działającego CRM”. Sam ZIP nie zapewnia
uwierzytelniania ani danych. Nie uruchamiaj skryptu demo na Contabo. Lokalny test
integracyjny opisany w raporcie zakłada wyłącznie nowe fikcyjne konta we własnej
bazie i nie wczytuje konfiguracji lokalnej instalacji właściciela.

## Widoki i znaczenie liczników

| Widok / kafelek | Rzeczywiste dane |
|---|---|
| Companies | Liczba firm w `owner_vault.companies`; lista, kraj/status/search, kontakty konkretnej firmy |
| Contacts | Liczba osób w `owner_vault.contacts`; lista, źródło, daty, stan weryfikacji, szczegóły |
| Duplicates Prevented | Zgłoszenia zatrzymane przez deduplikację V1 + zgłoszenia ręcznie powiązane z istniejącym kontaktem; kliknięcie daje tę samą historię |
| Overnight Activity | **Nowe firmy + nowe kontakty**, nie suma logów/zgłoszeń ani fikcyjnych działań agentów; szczegóły w dwóch podwidokach |
| Review queue | Otwarte konflikty/niejednoznaczne intakes; oddzielne odnośniki z Overview do kontaktów i firm oznaczonych `review_required` |
| Intake history | Oryginalne wyniki przyjęć, także zatrzymane duplikaty, decyzje weryfikacji i archiwum rozstrzygnięć |
| Change history | Niezmienne prywatne snapshoty przed/po edycjach i weryfikacjach kontaktów wykonanych od V2, z uzasadnieniem |

Overnight: ostatni **zakończony** przedział 18:00–08:00 `Europe/Oslo`, początek
wliczony, koniec wyłączony. Przed 08:00 wyświetla poprzednią zakończoną noc.
Zmiana czasu daje 13 lub 15 godzin. Serwer zwraca okno; przeglądarka nie ustawia
zegara ani zakresu statystyk. V2 dodaje liczbę firm i sumę rekordów, nie zmienia
historycznej definicji `newContactsOvernight` z V1.

Listy pobierają 10/25/50 rekordów na stronę, nigdy całej bazy do przeglądarki.
Wyszukiwanie/status/kraj działają w PostgreSQL. Filtr firmy izoluje jej kontakty.
Brak lub błąd danych jest komunikatem niedostępności, nie licznikiem zero.
Firmowe podsumowanie źródeł pokazuje do pięciu źródeł kontaktów; pełna historia
pochodzenia pozostaje w intakes i szczegółach osób.

## Edycja i decyzje

- Kontakt: imię/nazwisko, stanowisko, służbowy e-mail i jego rodzaj, profil HTTPS.
  Weryfikacja osoby jest oddzielną udokumentowaną decyzją.
- Firma: nazwa, sektor, witryna HTTPS, niezależny status weryfikacji firmy.
  Potwierdzenie firmy/kontaktu nie zatwierdza użytkownika, członkostwa ani oferty.
- Kraj, numer rejestrowy, przypisanie osoby do firmy i pierwotne źródło są
  zablokowane w edytorze/API. Nie ma cichej zmiany pracodawcy ani tożsamości firmy.
- Każda zmiana wymaga bieżącej wersji, uzasadnienia 10–500 znaków, CSRF i świeżego
  MFA z ostatnich pięciu minut. „MFA confirmation for changes” wykorzystuje
  istniejący zweryfikowany czynnik. Nie tworzy nowego systemu logowania.
- Nieaktualna wersja lub cudzy klucz tożsamości daje HTTP 409 i brak nadpisania.
  Odczytaj aktualny rekord i ponownie oceń zmianę; nie ponawiaj zapisu w ciemno.
- Dawne klucze pozostają aliasami historycznymi. Nowego klucza nie wolno przejąć
  od innej osoby. E-mail ogólny ani samo nazwisko nie łączą osób.

Kolejka dopuszcza **dismiss** (odrzucenie danego intake z zachowaniem historii)
lub **link_existing** (powiązanie wyłącznie z kandydatem rozpoznanym przez V1).
Powiązanie nie zmienia kontaktu. Wymaga zgodnej tożsamości firmy i braku mocnych
kluczy przypisanych innej osobie. Przy sprzecznych kluczach funkcja odmawia;
pozostaje analiza lub udokumentowane odrzucenie zgłoszenia. V2 nie udostępnia
automatycznego scalania, przenoszenia osób i kasowania historycznych dowodów.

Nie dodano formularza masowego importu ani company-only intake. Ręczne tworzenie
rekordu nadal obsługuje istniejące API V1 z rzeczywistą osobą kontaktową; integracja
maszynowa/company-only i faktyczny import wymagają osobnego V3 i zgód.

## Baza, API i ochrona danych

Migracja `202610230017_owner_vault_workspace.sql` jest addytywna:

- `company_versions`: metadane wersji firmy tworzone dopiero podczas jej edycji;
  wcześniej wersja 1 jest jawnie wyliczana. **Bez zmiany starych wierszy/kolumn**,
  więc dotychczasowe odciski pełnych rekordów pozostają identyczne przy migracji.
- `changes`: prywatne, niezmienne before/after + autor/uzasadnienie/czas;
- `resolutions`: jedna niezmienna decyzja na intake; oryginały pozostają nietknięte.

Wszystkie nowe tabele: FORCE RLS, brak surowych praw API/integracji, dostęp
przez funkcje właściciela `shadowbridge_vault_executor` NOLOGIN/NOBYPASSRLS.
Nowe funkcje mają pusty search_path i jawne ACL. Nowych praw nie dostają Sentinel,
policy, sessions ani grupa ingest. Historycznych migracji 001–016 nie zmieniono.

| Endpoint | Cel |
|---|---|
| GET `/api/owner/vault/workspace/statistics` | Rozszerzone rzeczywiste liczniki; zegar serwera |
| GET `/api/owner/vault/workspace/{contacts,companies,intakes,history}` | Listy ograniczone stroną; `q,status,page,limit,country`, odpowiednio `companyId,period,queue` |
| GET `/api/owner/vault/workspace/{contacts,companies}/:id` | Szczegóły rekordu |
| GET `/api/owner/vault/workspace/history/:resourceId` | Stronicowana historia konkretnej firmy/osoby |
| PATCH `/api/owner/vault/{contacts,companies}/:id` | `{data,version,reason}`; zamknięta lista edytowalnych pól |
| POST `/api/owner/vault/intakes/:id/resolve` | `{decision,contactId?,version,reason}`; wersja 1 oznacza nierozstrzygnięty intake |
| POST `/api/owner/vault/contacts/:id/review` | Dotychczasowa decyzja V1, dodatkowo prywatny snapshot V2 |

API V1 pozostaje dostępne; nowe UI używa kontraktu workspace. Historyczny
licznik V1 `reviewRequired` nadal obejmuje historyczne intakes; V2 liczy otwarte
sprawy, nie modyfikując ich pierwotnego statusu. Wcześniejsze decyzje zachowały
się w Intake history; nie stworzono wstecz fikcyjnych snapshotów zmian.

Wszystkie odpowiedzi mają `no-store`. Brak browser storage, zewnętrznej analityki,
eksportu, pobierania firmowych URL i wysyłki do AI. Tekst jest renderowany przez
textContent. Wylogowanie/zmiana sesji/anulowanie uprawnień usuwa UI CRM i anuluje
żądania. Dostęp OWNER jest ponownie sprawdzany podczas odświeżania sesji.

Limit VAULT na zweryfikowane konto **i adres**: 240 odczytów / 5 min oraz osobny
limit 40 zmian / 5 min. Pozostałe limitery aplikacji pozostały przy swoich zasadach.
API nie przyjmuje principalu z przeglądarki. Odmowy i klasy błędów trafiają do
prywatnego audytu, nie do ogólnego audytu pracowników. Snapshoty zawierają dane
CRM i muszą mieć te same ograniczenia dostępu/backupów i zatwierdzoną retencję.

Nie ma DELETE, automatycznej retencji ani anonimizacji. Przed prawdziwym importem
wymagane są zatwierdzone zasady źródeł, celu/podstawy przetwarzania, retencji,
sprostowań i kontrolowanego usunięcia. Nie deklarujemy pełnej zgodności prawnej.

Wyniki: [OWNER-VAULT-V2-REPORT.md](OWNER-VAULT-V2-REPORT.md).
Przyszłe wdrożenie: [OWNER-VAULT-V2-RELEASE.md](OWNER-VAULT-V2-RELEASE.md).
