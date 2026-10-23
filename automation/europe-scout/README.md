# European B2B Scout V1 — pilot n8n

**Nie zainstalowano tego workflow na Contabo. Nie ma integracji z CRM.**
Plik do importu: [`europe-b2b-scout-v1.json`](europe-b2b-scout-v1.json).
Wersja docelowa: **self-hosted n8n 2.44.6**, natywne Data Tables.

## Stan źródeł przed pierwszym uruchomieniem

Przygotowano adaptery NO / Brønnøysund i CZ / ARES. W środowisku
deweloperskim proxy zwraca HTTP 403 zarówno dla oficjalnych API, jak i ich
dokumentacji. **Nie potwierdzono odczytu rzeczywistych firm ani aktualnych
warunków ARES.** Import jest gotowy technicznie; zbieranie danych pozostaje
wyłączone do sprawdzenia źródeł przez operatora. Szczegóły i linki:
[`SOURCES.md`](SOURCES.md). Nie obchodź blokad ani limitów.

## Import i konfiguracja — bez poleceń na serwerze

1. W prywatnym n8n otwórz projekt dostępny wyłącznie właścicielowi/operatorowi
   pilota. **Nie dodawaj poświadczeń PostgreSQL, OWNER, CRM ani API ShadowBridge.**
   Zrób eksport/kopię istniejącej konfiguracji n8n zgodnie z obecną procedurą.
2. W **Data tables → Create data table** utwórz
   `shadowbridge_europe_scout_pilot_v1`. Dodaj kolumny:

   | Kolumna | Typ |
   |---|---|
   | `scout_key` | String |
   | `revision` | Number |
   | `state_json` | String |

   Zaimportuj [`pilot-seed.csv`](pilot-seed.csv) do tej tabeli, mapując powyższe
   kolumny i typy. Powinien istnieć **dokładnie jeden wiersz**, revision `0`,
   scout_key `europe-scout-v1`. Nie importuj pliku drugi raz do istniejącego pilota.
   Systemowe `id`, `createdAt`, `updatedAt` tworzy n8n. Nie używaj tabel CRM.
   Jeśli panel nie udostępnia importu CSV do istniejącej tabeli, dodaj ręcznie
   **jeden** wiersz: `scout_key` = `europe-scout-v1`, `revision` = `0`,
   a `state_json` =
   `{"version":1,"companies":{},"days":{},"sources":{},"cursors":{},"events":[],"commit":"initial"}`.
   Wybierz jedną metodę inicjalizacji; nie łącz importu z ręcznym dodaniem wiersza.
3. **Workflows → Import from file**: wybierz JSON. Zapisz w tym samym projekcie
   co tabela. Workflow jest nieaktywny. Węzły Data Table wybierają tabelę po nazwie;
   jeśli interfejs wymaga ponownego wyboru, wskaż tę samą tabelę we wszystkich
   sześciu węzłach Data Table. Nie wybieraj innej tabeli.
4. Naciśnij **Execute workflow** z oboma flagami w węźle **Source approvals**
   równymi `false`. Oczekiwany `Pilot summary`: zero pozyskanych firm i brak
   zapytań do rejestrów. Błąd o brakującym/zdublowanym journal oznacza konieczność
   poprawienia konfiguracji tabeli, nie ponownego seedowania działającego pilota.
5. Przed włączeniem konkretnego kraju sprawdź aktualne warunki z `SOURCES.md`
   i wykonaj w przeglądarce/operatorowym narzędziu pojedynczy oficjalny odczyt
   opisany poniżej. Zapisz datę, wersję warunków i wynik **poza publicznym GitHubem**.
   Dopiero wtedy ustaw odpowiednią flagę `NO` lub `CZ` na `true`, wykonaj jedną
   próbę ręczną i obejrzyj `Pilot summary` oraz `state_json`. Jeśli wynik jest
   prawidłowy, aktywuj/publikuj workflow **ręcznie** w n8n. Nie włączaj źródła,
   którego odczyt/licencja nie zostały potwierdzone. Ten pakiet nie zmienia ustawień n8n.

Minimalne próbki (nie publikuj odpowiedzi w repozytorium):

- NO: GET `https://data.brreg.no/enhetsregisteret/api/enheter?organisasjonsform=AS&naeringskode=28&size=1&page=0`
- CZ: POST `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat`,
  JSON `{"pravniForma":["112","121"],"czNace":["28"],"start":0,"pocet":1}`,
  Content-Type `application/json`.

Sprawdź także, czy źródło nadal przyjmuje kody/prefiksy klasyfikacji i kody
form prawnych użyte w workflow. Schemat historyczny nie jest dowodem aktualnego API.

## Co robi pilot

- Codziennie **03:15 Europe/Oslo**. Ta godzina omija zmianę czasu o 02:00.
  Ręczny start używa tych samych trwałych limitów.
- Dwa kraje na przebieg, po jednym zapytaniu (maks. 25 wyników) na kraj.
  Kolejność krajów i sektory rotują według daty Oslo: maszyny `28`, metal `25`,
  tworzywa `22`, żywność `10`, hurt `46`. To konserwatywny pilotaż, nie pełny eksport
  rejestrów; firmy import/export bez odpowiedniego kodu mogą zostać pominięte.
- NO: tylko AS/ASA; CZ: tylko s.r.o./a.s. (`112`/`121`). Pomijane są osoby prowadzące
  jednoosobową działalność, rekordy bez identyfikatora/nazwy/kodu i jawnie nieaktywne.
  Nie pobieramy reprezentantów, właścicieli, kontaktów ani adresów ulicznych.
- Maksymalnie **50 nowych kandydatów/dzień**, dodatkowo 25 na kraj/dzień;
  maks. 8 prób HTTP/dzień łącznie i 4 na źródło, także po awarii/restartach.
  Typowy przebieg to tylko 2 zapytania. Strona źródła i kursory są trwałe,
  maks. 10 000 pozycji na sektor; pełna strona przesuwa kursor, koniec zawija.
- Deduplikacja przez `NO:<orgnr>` / `CZ:<ICO>`, nigdy przez podobieństwo nazw.
  Pierwszy rekord pozostaje niezmieniony: to pilot pozyskiwania, nie synchronizacja CRM.
- Profil działalności wyznacza wyłącznie **potencjał współpracy do przeglądu**.
  Wszystkie rekordy mają `surplusEvidence=not_provided_by_registry`.
  Nie ma automatycznego `verified`, potwierdzenia zapasów, członkostwa ani dostępu.
- Brakujące dane to `null`, nie wymyślone kontakty. Witryna tylko wtedy, gdy źródło
  NO podaje jawny URL HTTP(S); schemat ARES użyty w V1 nie dostarcza WWW.

## Dlaczego jeden wiersz zawierający journal JSON

Natywny Data Table upsert nie zapewnia własnego unikatowego klucza firmy i nie
łączy licznika dziennego z insertem firmy w jedną transakcję. V1 używa **jednego
wiersza pilota z warunkowym UPDATE (`id` + `scout_key` + `revision`)**.
Wewnątrz `state_json`: firmy, liczniki dzienne, kursory, cooldown źródeł i ostatnie
100 zdarzeń technicznych. Sprawdzenie wyniku UPDATE zapobiega przyjęciu zapisu
innego wykonania. Wyścig przy commit kończy przebieg bez przesunięcia jego kursora;
następny przebieg ponawia stronę z deduplikacją. Nie usuwaj ani nie edytuj tego
wiersza podczas aktywnego przebiegu.

To kompromis małego pilota: **brak wygodnego jednego wiersza na firmę w GUI**.
Limit **500 firm / 1,5 mln znaków JSON** zatrzymuje pozyskiwanie; nie nadpisuje
starych danych. Oglądaj firmy po rozwinięciu `state_json`, eksportuj tylko do
prywatnej analizy. Po osiągnięciu limitu wyłącz workflow i zdecyduj o dalszym
przeglądzie/retencji. Nie twórz drugiej bazy CRM. V3 musi mieć osobno zatwierdzony
kontrakt maszynowy. Tabela pilota jest danymi roboczymi, nie katalogiem kontrahentów.

## Awarie i zatrzymanie

- HTTP timeout 15 s, brak retry w węźle HTTP, przekierowania wyłączone.
- 429, 5xx, timeout: zapis przerwy **co najmniej 15 minut** lub dłuższej wynikającej
  z `Retry-After` (sekundy lub data HTTP). **Bez ponawiania w tym przebiegu**;
  następna noc pomija źródło, jeśli termin jeszcze nie upłynął. Inny kraj działa dalej.
- 4xx poza 429 lub niezgodny schemat: `sourceState.<kraj>.blocked=true`.
  Wyłącz flagę kraju, sprawdź warunki/schemat i popraw adapter przed ręcznym
  odblokowaniem pola `blocked` przy nieaktywnym workflow i po kopii tabeli.
  Nie kasuj firm, liczników ani kursora, żeby „naprawić” błąd.
- Rezerwacja zapytania wygasa po 120 s; zużyty budżet próby pozostaje zapisany.
  To bezpieczne również przy przerwaniu kontenera. Kolejna noc wznowi stronę.
- Aby zatrzymać: **Deactivate/Unpublish workflow**. Tabela pozostaje.
  Wycofanie: przywróć poprzedni eksport workflow; nie importuj ponownie seed CSV.
  Przed aktualizacją eksportuj tabelę i workflow do prywatnego backupu.

## Prywatność i granice

Nie ma Code node, AI, Execute Command, osobnego sandboxa ani zewnętrznych bibliotek
w wykonaniu workflow. Logika jest w standardowych wyrażeniach natywnych węzłów
Set/IF; nie wymaga task runnera ani osłabienia zabezpieczeń n8n.
Jedyny HTTP wychodzący prowadzi do wybranych oficjalnych rejestrów. Nie otwieramy
stron firm. Brak e-maili/outreach i jakichkolwiek credentials w JSON.

Zapisy wyników wykonania n8n są wyłączone, także błędnych i ręcznych. Podczas
ręcznego wykonania operator nadal widzi dane wejścia/wyjścia w edytorze; rejestr
może zwrócić pola osobowe, których adapter nie zapisuje. Nie przypinaj odpowiedzi,
nie eksportuj run data ani zrzutów z rzeczywistymi rekordami. Dane trwałe pilota
to wyłącznie whitelistowane pola firm i techniczne zdarzenia bez raw payloadów.
Ogranicz dostęp do całego projektu n8n i jego backupów; nie publikuj tabeli/linków.
Proponowany czas pilota to maks. 30 dni, potem ręczny przegląd i decyzja o retencji
lub usunięciu samej tabeli. Nie jest to automatycznie wdrożona polityka retencji.

## Testy dla developera

```sh
node --test automation/europe-scout/scout.test.mjs
node automation/europe-scout/n8n.integration.mjs
```

Druga komenda potrzebuje lokalnego Dockera, ok. 2 GB wolnego miejsca i obrazu
n8n 2.44.6 wskazanego przez digest. Tworzy wyłącznie nowy kontener i sieć z losową
nazwą; port tylko 127.0.0.1. Rejestry zastępuje lokalny serwer fikcyjnych odpowiedzi.
Na końcu usuwa wyłącznie swoje zasoby. Nie uruchamiaj jej na Contabo ani w
istniejącym kontenerze produkcyjnym. Wyniki: [`TEST-REPORT.md`](TEST-REPORT.md).
Generator: `node automation/europe-scout/build-workflow.mjs`.

Mapowanie przyszłej integracji: [`OWNER-VAULT-MAPPING.md`](OWNER-VAULT-MAPPING.md).
