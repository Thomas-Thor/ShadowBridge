# Canary: kontrola przed uruchomieniem, 25.10.2026

**PREPARED:** odczytowa kontrola kodu i niezależny kolektor diagnostyczny.
**SCHEDULED: NIE. EXECUTED: NIE.** Brak terminu startu; nic nie zostało dodane do
n8n. Faktyczne nowe rekordy CRM i płatne wywołania wykonane w tym zadaniu: 0.
Nie zapisano tego raportu do Book: brak autoryzowanego zapisu.

OWNER potwierdził wdrożenie/odbiór 236e04b i API Book. Nie uruchamiać ponownie
`owner-next-step.mjs --apply` lub instalatora `--book-api` w celu diagnostyki.
Ten checkpoint uzupełnia historyczne `execution-results.json` sprzed zgłoszonego
odbioru produkcyjnego. Nie zmienia jego historycznych wyników testów.

## Pierwszy rzeczywiście niewykonany krok

Odczyt aktualnego zakresu z OWNER Book i rzeczywistych praw/limitów źródeł oraz
centralnego CRM. W tej sesji nie ma wywoływalnych narzędzi Book/Apollo/Clay/n8n,
autoryzowanego SSH ani sekretu Book. OWNER potwierdza zalogowane wtyczki ChatGPT;
nie rekonfigurujemy ich. Stan połączeń n8n z tymi kontami: **UNVERIFIED**.

Ponowiono trzy publiczne GET (health, notes bez klucza, healthz n8n): proxy
CONNECT 403/origin 000, również poza sandboxem. Nie jest to awaria Contabo ani
dowód braku połączeń n8n. Żadnego żądania do Apollo/Clay lub enrichment.

Po pierwszej odpowiedzi bez fragmentu OWNER przekazał ręcznie notatkę Book o
monitorowaniu kredytów. Zawiera datowany odczyt kredytów leadów Apollo oraz
niejednoznaczny licznik Clay. Saldo, plan/cykl i surowy licznik konta pozostają
prywatne: nie zapisujemy tych wartości w publicznym repozytorium. Źródłem jest
fragment przekazany przez OWNER, nie nowy odczyt API wykonany przez Codexa.

Nie podano jeszcze rynków, produktów, maksimum rekordów ani zatwierdzonych
budżetów tego canary. Nie wybieramy ich ze starszych przykładów ani nie uznajemy
salda konta za zgodę na zużycie. Obecna blokada kosztów: **0 dopuszczonych
płatnych operacji**. Nie oznacza to salda 0 u dostawcy. Koszt konkretnego
search/read, limit API i dostęp źródła z n8n nadal wymagają potwierdzenia.
Notatka opisuje przyszły Credits & Usage Monitor; nie rozpoczynamy budowy nowego
modułu w ramach tych dwóch zadań. Liczniki kredytów różnych rodzajów i narzędzi
muszą pozostać oddzielne; nie wyliczamy kosztu/procentów z licznika Clay.

## Istniejąca praca zachowana

Workflow LATAM/ASIA/EUROPE/report pozostają `active:false`, approval gate false.
Konfiguracje źródeł są puste; kod ochrony kosztów/deduplikacji i SQL guard są
przygotowane, ale dostarczenie regionalnych wyników do centralnego CRM nie jest
podłączone. SQL guard nie jest automatyczną migracją. Nie stosować go do produkcji
ani nie przełączać na sesję OWNER/DBA tylko po to, żeby canary wystartował.
Nie wdrażać starszej gałęzi acquisition jako aplikacji R1.

Stosować wyłącznie istniejący centralny CRM z ograniczonym przyjęciem i trwałym
potwierdzeniem ID. Outbox, plik JSON lub sukces wykonania n8n nie oznacza zapisu
w CRM. Próba powtórzenia tej samej partii musi zachować deduplikację i brak
nadpisywania kuratorowanych pól. Brak CRM lub niejednoznaczna tożsamość blokuje
operację kosztową. Zwykła firma pozostaje LEAD; STOCK SIGNAL wymaga konkretnego
źródła i daty sygnału towaru, VERIFIED DEAL wymaga dowodu i ludzkiego przeglądu.

## Bezpieczna diagnostyka niezależna od wdrożenia

Dodano `owner-readiness-only.mjs`. Uruchomienie bez argumentów jest offline.
Tryb `--read-only` na lokalnym komputerze OWNER używa istniejącego SSH i klucza
hosta, przypiętego odczytowego kolektora d3e1007 i publicznych GET. Nigdy nie
wywołuje instalatora, workflow, dostawcy ani zapisu DB. Nie wymaga checkoutu lub
aktualizacji Contabo. Wynik ma `productionUpdated:false`, `scheduled:false`,
`executed:false`, `book.scopeSource:NOT_READ`. Nie zmienia checkpointu odbioru R1.

Potrzebne są oba pliki tego samego commita na lokalnym Linuxie:
`owner-readiness-only.mjs` i importowany `owner-next-step.mjs`; uruchomić tylko
pierwszy z `--read-only`. Nie uruchamiać `--apply`. Kolektor nie pyta o klucze:
bez n8n API key nie potwierdzi listy workflow, uprawnień do tworzenia ani sald.
Nawet zdrowe n8n i anonimowe 401 Book nie otwierają bramki canary.

Jeżeli dalsza kontrola potwierdzi brak poświadczeń źródeł, bezpiecznym miejscem
jest magazyn Credentials **istniejącego** n8n, w prywatnym projekcie OWNER,
z ograniczonym dostępem. Nie kopiować kluczy z wtyczek ChatGPT do czatu ani kodu.
Zakres, endpoint, prawo odczytu i koszt muszą być potwierdzone przed podłączeniem
credential do węzła. Nie tworzymy nowych kont, poświadczeń lub importu teraz.

## Warunki jednorazowego startu

Po uzyskaniu zakresu Book: ustalić twarde maksimum rekordów i osobne limity
kredytów Apollo/Clay, aktualne saldo, maksymalny koszt wywołania oraz ograniczone
poświadczenia n8n. Nieznany koszt blokuje tę operację; inny niezależny przepływ
może działać tylko przy potwierdzonym koszcie, zakresie i odbiorcy CRM.
Pierwszy test musi przejść bez płatnych wywołań. Żadnego automatycznego mailingu.

Start później musi być jednorazowy, z absolutną datą UTC i prezentacją
Europe/Oslo z offsetem oraz trwałym identyfikatorem/checkpointem. 25.10.2026
godzina 02:00–02:59 występuje dwukrotnie: CEST (+02:00), potem CET (+01:00).
Nie włączać istniejącego cyklu dziennego lub niejednoznacznego cron 02:00
w zastępstwie jednorazowego startu. **Nie wybrano i nie zarezerwowano terminu.**

Nowe testy: 3/3 lokalne przypadki kolektora (fikstury, nie Contabo), składnia
Node i diff check PASS. Historyczne testy SQL guardów i workflow zachowano bez
ponawiania. Nadal nieprzetestowane: rzeczywiste prawa API, kredyty, odczyt zakresu
Book, importer n8n, zapis i powtórzenie canary w centralnym CRM.
