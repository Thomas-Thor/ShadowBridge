# Nightly Global Acquisition: pakiet do przeglądu OWNER

Stan 24.10.2026: **workflow przygotowane do importu nieaktywnego; uruchomienie ZABLOKOWANE**. Niczego nie wdrożono na Contabo. Nie pozyskano rzeczywistych kontaktów. Nie zmieniono czterech istniejących Scoutów Relevance AI ani pilota NO/CZ.

## Co zawiera pakiet

| Workflow | Harmonogram Europe/Oslo | Zadanie |
|---|---|---|
| [latam.json](latam.json) | 01:00 | Meksyk i pozostałe zatwierdzone kraje LATAM |
| [asia.json](asia.json) | 02:00 | Producenci, fabryki, eksporterzy, odzież; nadwyżki wyłącznie z dowodem |
| [europe.json](europe.json) | 03:00 | Hurt, import, kupujący, udokumentowane stocki, palety i likwidacje |
| [report.json](report.json) | 08:00 | Prywatne podsumowanie OWNER, bez mailingu |

Wszystkie JSON mają `active:false` oraz drugi, domyślnie zamknięty `OWNER approval gate`. Import nie uruchamia harmonogramu. Wykonanie ręczne z zamkniętą bramką zwraca informację DISABLED, a nie pozorny wynik pozyskania.

Cel 1000 nowych rekordów łącznie/noc jest konfigurowalny, nie jest gwarancją ani limitem 50. Firma, osoba i okazja są osobnymi typami rekordów, więc 1000 rekordów nie oznacza 1000 osób. Domyślny bezpiecznik to 5000 nowych rekordów i 3 równoległe dzierżawy stron. To ustawienia tego pakietu, nie odczyt limitów kont.

## Mechanizm

- Własne rekordy kolejki i kursory każdego źródła/regionu/dnia Oslo, dzierżawy 120 s i atomowy zapis strony z checkpointem. Po awarii nowy worker może przejąć wygasłą dzierżawę; stary nie może nadpisać checkpointu. Oczekujące zadania mogą być wznowione do 7 dni wstecz.
- Paginacja numerem strony albo nieprzezroczystym tokenem. Maksymalnie 100 wierszy odpowiedzi i 500 znormalizowanych obiektów w partii, bez jednego globalnego pliku JSON. Zmiana schematu odpowiedzi zatrzymuje stronę bez przesunięcia kursora.
- Po udanym zapisie odstęp 2 s; HTTP timeout 15 s, bez automatycznych agresywnych ponowień i przekierowań. 429, 5xx i timeout odraczają źródło o co najmniej 15 min i respektują dłuższy `Retry-After`. Błędy 4xx poza 429 blokują źródło; 8 kolejnych nieudanych podejść wymaga przeglądu.
- Limity wspólne dla konta dostawcy API oraz osobne dla źródła. Rezerwacja górnej granicy kosztu PRZED żądaniem. Nieznany koszt, niepotwierdzony dostęp API, wyczerpane limity albo nieaktualne saldo dla płatnego odczytu blokują żądanie.
- Deduplikacja firmy: kraj + numer rejestrowy; przy braku numeru tylko stabilny identyfikator źródłowy. Takie firmy mają oznaczenie `source_only` do dalszego przeglądu, bez obietnicy globalnej unikalności. Nie łączymy firm po samej podobnej nazwie.
- Osoby: zawodowy URL, jawnie oznaczony indywidualny e-mail + firma albo stabilny identyfikator źródła. Wspólny adres `info@` nie jest tożsamością osoby. Brakujące pola pozostają puste; nie zgadujemy adresów, telefonów, witryn czy zapasów.
- BUY/SELL/SURPLUS wymagają jawnego typu, identyfikatora ogłoszenia, opisu i URL dowodowego. Producent odzieży nie staje się automatycznie posiadaczem nadwyżek.
- Jesienne podwójne 02:00 nie tworzy dwóch zadań dla tego samego dnia. Opcjonalny trigger `Resume unfinished jobs` (domyślnie wyłączony) działa co kwadrans od godziny regionu do 07:45. Jego zatwierdzone włączenie zapewnia też wznowienie ASIA po nieistniejącym wiosennym 02:00. Nie zmienia harmonogramu agentów Relevance.
- Tekst raportu oraz normalizowane opisy zastępują długie pauzy zwykłym `-`. Brak węzłów wysyłających e-mail/WhatsApp, uruchamiających agentów czy płatne wzbogacanie.

## CRM: ważna granica zakresu

W obecnym kodzie OWNER VAULT działa jako prywatne API rzeczywistego OWNER + MFA + CSRF. Nie istnieje zatwierdzony, ograniczony kontrakt maszynowy V3, do którego można podłączyć tych workerów. Nie należy używać sesji OWNER, klucza administratora ani połączenia DBA w n8n.

`storage.sql` to **kandydat kolejki technicznej/outbox**, poza katalogiem automatycznych migracji. Nie jest drugą bazą CRM, nie zawiera ekranów zarządzania kontaktami i nie zapisuje do OWNER VAULT. Został uruchomiony wyłącznie w nowej izolowanej bazie z fikcyjnymi danymi. Wszystkie nowe obiekty mają stan `blocked_vault_v3`; raport rozdziela `crmPending` i `crmDelivered`.

Zanim zaczniemy pobierać prawdziwe dane, potrzebne są: zatwierdzony istniejący odbiorca CRM albo osobno zaakceptowany kontrakt V3, dozwolone pola/retencja i potwierdzenie dostarczenia. Ten pakiet nie uruchamia importera ani nie pozoruje takiej integracji. Automatyczna retencja i transfer do CRM nie są tu zaimplementowane. Nie stosować SQL do produkcyjnej bazy w ramach obecnego zadania.

## Dostęp, źródła i koszty

Nie ma w tej sesji dostępu SSH, kluczy ani konektorów do kont. Odczyt HTTPS n8n i oficjalnych dokumentacji został zablokowany przez proxy (CONNECT 403, również po ponowieniu poza sandboxem). To **nie jest dowód awarii Contabo**. Nie znamy trybu produkcyjnego n8n, faktycznych praw API, pozostałych sald ani kosztów Scoutów.

| Zasób | Co należy potwierdzić na istniejącym koncie | Obecny stan |
|---|---|---|
| n8n 2.44.6 | wersja, tryb, zasoby, GET workflows/executions, projekt dostępny tylko OWNER/operatorowi | niepotwierdzone na Contabo |
| Apollo | dostęp do search API, faktyczny format, kraje/branże, paginacja, limity i koszt odczytu | brak dostępu; brak zatwierdzonego adaptera produkcyjnego |
| Clay | czy opłacony plan pozwala bezkosztowo odczytać istniejące wyniki/tabele | brak dostępu; żadnego wywołania enrichment/run |
| Relevance AI | ID czterech Scoutów, zapis wyników, koszt wykonania, jakość i dozwolony odczyt historycznych wyników | brak dostępu; żadnego triggera agenta |
| CRM | ograniczony, zatwierdzony zapis maszynowy i potwierdzenie odbioru | blokada V3 |

Linki do sprawdzenia: [Apollo search](https://docs.apollo.io/reference/people-api-search), [Apollo usage](https://docs.apollo.io/reference/view-api-usage-stats), [Clay](https://www.clay.com/pricing), [Relevance AI](https://relevanceai.com/pricing), [n8n API](https://docs.n8n.io/api/). Aktualnych warunków/limitów nie udało się odczytać, nie traktować historycznych cenników jako faktów. Nie obchodzimy ograniczeń scrapowaniem lub proxy.

**Budżet nowej aktywności obecnie: 0, bo wszystko jest wyłączone.** Nie oznacza to bezpłatności istniejących abonamentów ani gwarancji bezpłatnego uruchomienia. Nie da się rzetelnie podać miesięcznej kwoty bez planów i sald kont. Domyślne limity dodatkowych kredytów wynoszą 0; wywołanie z dodatnim kosztem wymaga jawnej zgody i znanego salda. Koszt dodatkowej infrastruktury nie jest ponoszony w tym zadaniu.

Model przepustowości: `strony = ceil(cel / (wiersze_na_stronie * obiekty_na_wiersz * (1 - udział_duplikatów)))`. Ilustracja, nie prognoza dostawcy: 1000 rekordów, 100 wierszy/stronę, 1 nowy obiekt/wiersz i 20% duplikatów daje 13 żądań wyszukiwania na noc. `koszt = żądania * potwierdzony_koszt_odczytu + wybrane_wzbogacenia * koszt_wzbogacenia`; obie stawki i dostępny wolumen pozostają NIEPOTWIERDZONE. Trzeba mierzyć osobno liczbę firm i ludzi oraz jakość i dostępność okazji.

Najpierw odczyt już opłaconych/dozwolonych wyników. Ewentualne przyszłe wzbogacanie wyłącznie wybranych rekordów z oddzielnym limitem, np. do 5% zaakceptowanych kandydatów, po decyzji OWNER. Nie ma tu wywołań enrichment ani zakupu kredytów. To nie limit całego systemu do 50 rekordów.

Czterech Scoutów Relevance pozostawiamy bez zmian. Propozycja kolejnego kroku: najpierw przegląd co najmniej 5 istniejących wykonań każdego agenta, potwierdzenie trwałego zapisu, unikalności, jakości i kosztu. Dopiero jeśli bilans to uzasadnia, OWNER może zatwierdzić jedno dodatkowe wykonanie dziennie wybranego Scouta z twardym limitem; ewentualne 12 h dopiero po ponownym pomiarze. Nie należy uruchamiać czterech agentów wielokrotnie w ciemno.

## Jedna czynność operatora TERAZ: diagnostyka tylko do odczytu

Na istniejącym Contabo jako `shadowadmin` wykonaj poniższy jeden blok i przekaż wyłącznie wynik JSON. Pobiera jeden sprawdzany sumą SHA-256 skrypt do `/tmp`. Nie instaluje n8n, nie zmienia konfiguracji, nie pyta baz, nie importuje ani nie uruchamia workflow/agentów. Do odczytu istniejącego lokalnego kontenera używa `sudo`. Wymaga obecnego Node.js na serwerze.

```bash
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/feature/nightly-global-acquisition/automation/nightly-global/collect-readiness.mjs' \
  -o /tmp/shadowbridge-global-readiness.mjs &&
printf '%s  %s\n' \
  'a3e6503c2c3c45bd68fd89edd3bdb5da39e43255115dd6f3381873240c44312b' \
  '/tmp/shadowbridge-global-readiness.mjs' | sha256sum -c - &&
sudo node /tmp/shadowbridge-global-readiness.mjs
```

Jeśli masz już klucz API n8n do odczytu, skrypt może przyjąć go w ukrytym lokalnym pytaniu. Jeśli go nie masz, naciśnij Enter, nie twórz nowego i nie przesyłaj żadnego sekretu do rozmowy. Skrypt nigdy nie wypisuje klucza, poświadczeń ani treści firm/kontaktów. Sprawdza tylko GET na lokalnym n8n, agregaty workflow i statusy ostatnich wykonań, zasoby oraz publiczny health/TLS. Liczba odniesień do Apollo/Clay/Relevance nie dowodzi dostępnych kredytów ani uprawnień tych kont. Nie potwierdzi prawa importu ani kosztu Scoutów. Ctrl+C bezpiecznie przerywa, żadna usługa nie jest zmieniana.

## Import i późniejsza aktywacja: dopiero po wynikach i zatwierdzeniu

1. W **istniejącym** n8n 2.44.6, w prywatnym projekcie OWNER, wybierz import z pliku osobno dla czterech JSON. Zachowaj `Inactive`, zamkniętą bramkę oraz wyłączone wznowienia. Nie importuj starego pilota NO/CZ w ramach tego pakietu.
2. Zweryfikuj na fikcyjnych danych natywne wykonanie w tej instancji. W Codexie sprawdzono generator, logikę i prawdziwy PostgreSQL; nie wykonano importu/pełnego przebiegu w n8n. Przed testem wymagane są zatwierdzone izolowane miejsce zapisu i zakresy dostępu.
3. Dopiero po osobnej zgodzie na storage skonfiguruj kolejkę kandydacką z `storage.sql` w zatwierdzonym miejscu, z backupem i retencją, **bez ręcznego podłączania do tabel CRM**. SQL nie tworzy haseł ani loginów. Poświadczenia n8n powinny należeć do dedykowanych LOGIN z minimalnym dziedziczonym `shadowbridge_acquisition_client`, niezależnym aktywnym bindingiem LATAM/ASIA/EUROPE/REPORT i bez praw DBA/OWNER/VAULT. Klient może wywoływać tylko trzy procedury, bez bezpośredniego SELECT tabel.
4. Przypisz w n8n istniejące, dopuszczone poświadczenia HTTP Header Auth osobno dla Apollo/Clay/Relevance oraz ograniczone poświadczenia PostgreSQL dla regionów. Placeholdery `OWNER_SELECT_*` są nazwami do wyboru, nie działającymi kluczami. Nie eksportuj konfiguracji z poświadczeniami do publicznego GitHuba.
5. `config.example.json` jest deklaracją polityki, nie automatycznym instalatorem. Brakuje potwierdzonych produkcyjnych kontraktów źródeł. Każde źródło musi mieć zatwierdzony endpoint GET/POST wyłącznie odczytowy, namespace stabilnych ID, mapowanie rzeczywistej odpowiedzi, filtry krajów/branż i paginację. `regionFilters` zawiera **zweryfikowane pola konkretnego API**, nie angielskie nazwy branż skopiowane w ciemno. Przykład w teście to fikstura, nie dowód aktualnego kontraktu Apollo. Niedostępne źródło pomijamy.
6. Uzupełnij jawne prawa API, saldo, maksymalny koszt żądania oraz wspólne i źródłowe limity dzienne/miesięczne. Ogranicz wynik do potrzebnych danych zawodowych i zatwierdź podstawę/retencję. Nie zapisuj nagłówków/kluczy w `sources.config`. Zapewnij zatwierdzony odbiór CRM, dopiero potem rozważ pobieranie prawdziwych rekordów.
7. Po udanym małym sprawdzeniu end-to-end i decyzji OWNER otwórz bramkę, ustaw `settings.enabled`, włącz harmonogramy i zatwierdzone wznowienia DST. Nie aktywuj enrichment ani triggerów czterech Scoutów. Każdy etap wymaga potwierdzenia faktycznych zapisów, nie tylko zielonego statusu n8n.

Raport 08:00 zawiera kraje, kategorie, nowe firmy/osoby/BUY/SELL/SURPLUS, duplikaty, błędy, czas pracy, wykorzystanie żądań, rezerwowane kredyty i blokady. Faktyczne kredyty pozostają `null`, dopóki nie zostaną uzgodnione z rozliczeniem dostawcy. Pełny agregat zapisuje się w prywatnej kolejce i wykonaniu raportu n8n; nie dodano go automatycznie do Command Center ani e-maila. Ogranicz dostęp do workflow, poświadczeń i raportu do OWNER/uprawnionego operatora. Dla pobierania wyłączono zapis treści wykonań, również ręcznych i błędnych.

Bezpieczny stop po późniejszej aktywacji: dezaktywacja nowych harmonogramów oraz zamknięcie `settings.enabled` zatrzymują nowe pobrania. Nie kasować istniejących danych ani agentów. Trwająca strona może dokończyć atomowy zapis; wznowienie używa tego samego checkpointu i deduplikacji. Odbiór CRM pozostaje oddzielnym etapem, bez cofania danych w OWNER VAULT.

## Testy i ograniczenia

Rzeczywiste wyniki: [TEST-REPORT.md](TEST-REPORT.md) i [results.json](results.json). Do powtórzenia wyłącznie testów czystej logiki: `node --test automation/nightly-global/unit.test.mjs automation/nightly-global/readiness.test.mjs`. Nie uruchamiać testu PostgreSQL na Contabo ani bazie właściciela.

Najkrótsza droga dalej: wynik jednej diagnostyki powyżej, następnie potwierdzenie kont/źródeł i odbiorcy CRM, zatwierdzony nieaktywny import i rzeczywisty test n8n, dopiero potem osobna zgoda OWNER na harmonogram. Bez tych faktów status pozostaje **BLOCKED FOR ACTIVATION**, nie „działająca globalna automatyzacja”.
