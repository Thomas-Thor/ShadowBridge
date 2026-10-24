# Nightly Global: rzeczywiste testy 24.10.2026

## Zaliczone

- **12/12 testów Node**: cztery nieaktywne eksporty i godziny Oslo, zgodność eksportów z generatorem, parametry SQL, blokowanie niedozwolonych endpointów/wzbogacania/wysyłki, rozdzielenie firm/osób/okazji, brak wymyślonych danych, silne identyfikatory, Retry-After i błędy, zmiana czasu, odczytowy kolektor bez ujawniania danych/klucza i odmowa wykonania na niewłaściwym hoście.
- **7/7 grup na rzeczywistym PostgreSQL**, świeża izolowana baza `nightly_global_test_bc0695f6`: transakcyjny schemat i zamknięta bramka, RLS i odmowa bezpośredniego odczytu/podszywania się pod region/rolę, zapis partiami i kursory, identyczne oraz zmienione powtórzenie strony, deduplikacja, budżety i 429, 8 równoległych procesów z dokładnie 3 przyznanymi dzierżawami, wygasłe dzierżawy, daty Oslo wiosną/jesienią, prywatny raport.
- Dane do bazy podawały odrębne procesy psql z `SET SESSION AUTHORIZATION` na fikcyjne role. To rzeczywisty test reguł PostgreSQL, **nie test logowania sieciowego poświadczeniem n8n**. Nazwy ról testowych są odseparowane od istniejących. Zegar kontrolowany wyłącznie funkcją w nowej bazie testowej; zegar systemu i stare bazy bez zmian.
- Zapisano **1200 unikalnych syntetycznych obiektów**: 600 firm, 400 kontaktów, 200 okazji. 6 partii po 200, **1484 ms**. Ponowne podanie 200 obiektów dało 0 nowych i 200 duplikatów, bez nadpisywania. Czas obejmuje lokalne przetworzenie/zapis testowy, **bez opóźnień dostawców API i bez wykonania n8n**. Nie jest prognozą nocy produkcyjnej ani dowodem 1000 kontaktów.
- Raport poprawnie rozdzielił 68 BUY, 66 SELL, 66 SURPLUS, 1200 oczekujących i **0 dostarczonych do CRM**. Saldo faktycznie pobranych kredytów pozostało niepotwierdzone (`null`), rezerwacja 2 fikcyjnych kredytów wykazała działanie ogranicznika, nie wydatek u dostawcy.
- Skontrolowano lokalnie schemat parametryzacji PostgreSQL native node z zachowanej, zatrzymanej fikstury n8n 2.44.6. Nie instalowano/uruchamiano drugiego n8n.

Początkowe nieudane próby ujawniły błąd składni SQL przy CASE oraz nieskuteczną zmianę payloadu w teście replay. Poprawiono oba i wykonano komplet 7 grup na nowej bazie z wynikiem PASS. Po tym przebiegu zmieniono tylko blokowanie endpointów w funkcji budowy żądań, kolektor i testy zgodności JSON; 12 testów tych fragmentów przeszło. SQL i normalizacja zapisanych rekordów nie zmieniły się od ostatniego przebiegu PostgreSQL. Nie powtarzano regresji całego ShadowBridge.

## Niewykonane / blokady

- Odczyt rzeczywistego Contabo/n8n i kont Apollo/Clay/Relevance: brak SSH/konektorów/kluczy, publiczny HTTPS i dokumentacje blokowane przez proxy CONNECT 403, również po próbie poza sandboxem. Origin HTTP 000 nie jest odpowiedzią serwera Contabo.
- Import oraz pełny przebieg w działającym n8n 2.44.6: **NIEPRZETESTOWANE**. Generator i logika sprawdzone lokalnie nie zastępują tej kontroli.
- Faktyczne filtry/paginacja uprawnionych źródeł i rzeczywisty wynik wyszukiwania: **NIEPOTWIERDZONE**, 0 rzeczywistych firm/osób/okazji pozyskanych.
- Realne limity, koszt odczytu, saldo i koszt czterech Scoutów: **NIEZNANE**, nie zużyto ich kredytów.
- Zapis maszynowy do OWNER VAULT: **BRAK KONTRAKTU V3**, nie podłączono ani nie przyznano dostępu. Outbox nie jest wynikiem dostarczenia do CRM.
- Automatyczna retencja, ewentualne wzbogacanie oraz wyświetlenie raportu w Command Center: **NIEZAIMPLEMENTOWANE w tym pakiecie**. Raport może być oglądany wyłącznie jako ograniczony agregat istniejącego n8n po zatwierdzeniu importu.

## Zachowanie środowiska

Ciężki checkout i testowa przestrzeń Dockera mieszczą się na osobnym `/tmp`, z kontrolą miejsca/inodów i rezerwą. Nie używano globalnego prune, resetów ani kasowania baz. Bazy testowe i wyniki w `.local` zachowano prywatnie. W publicznym Git znajdują się tylko fikcyjne dane testowe i agregaty wyników. Istniejący lokalny stos właściciela, Contabo, produkcyjne dane, MFA, DNS i czterej Scoutowie pozostają bez zmian.

**Wniosek:** fundament kolejkowania i pliki nieaktywnego importu przygotowane. **Uruchomienie globalnego pozyskiwania nadal BLOCKED** do sprawdzenia dostępu, źródeł, budżetów, retencji, odbiorcy CRM i rzeczywistego testu w istniejącym n8n.
