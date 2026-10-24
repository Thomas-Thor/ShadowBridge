# Źródła i ograniczenia — aktualizacja 24.10.2026

**Wynik ponownej weryfikacji: bieżące kontrakty API i warunki nadal niepotwierdzone.**
Próba jednego zapytania o maks. jedną firmę na rejestr zatrzymała się na CONNECT
proxy (403/Envoy, HTTP źródła `000`), również przy zwykłym ponowieniu poza sandboxem.
Nie odebrano odpowiedzi żadnego rejestru. Nie obchodzono blokad. Workflow i zgody
NO/CZ pozostają wyłączone. [Raport 24.10](SOURCE-VERIFICATION-2026-10-24.md).

**Nie jest to potwierdzenie aktualnej licencji każdego źródła ani porada prawna.**
Oficjalne API i strony z warunkami NO/CZ zwróciły w tym środowisku 403 z proxy,
również po ponowieniu poza sandboxem. Nie wykonywano obejść, rotacji IP ani
scrapingu. Nie otrzymano próbki rzeczywistych firm; nic takiego nie trafia do Git.
Flagi źródeł w dostarczonym workflow są `false` do potwierdzenia dostępu i warunków.

| Kraj / źródło | Ustalenia i model dostępu | Decyzja V1 |
|---|---|---|
| Norwegia — Brønnøysundregistrene | Oficjalny schemat dokumentuje REST `/enheter`, filtry branży/formy i paginację oraz NLOD. Zawiera changelog 2018; nie dowodzi obecnych limitów, wersji klasyfikacji ani pełnego formatu odpowiedzi. | Adapter przygotowany i testowany na fikcyjnych danych; nie potwierdzono aktualnego kontraktu ani warunków. |
| Czechy — ARES, Ministerstvo financí | POST `/ekonomicke-subjekty/vyhledat`, ICO, CZ-NACE, forma prawna i siedziba są zgodne z dotychczas użytym SDK; nie pobrano aktualnego oficjalnego OpenAPI/warunków. | Adapter przygotowany i testowany na fikcyjnych danych; SDK nie potwierdza praw do danych ani bieżącego kontraktu. |
| Polska — GUS / REGON BIR | Oficjalny interfejs BIR, zwykle dostęp z indywidualnym kluczem oraz warunkami GUS. Nie otrzymano klucza; nie potwierdzono prawa do takiego hurtowego pozyskiwania w bieżących warunkach. | Analiza, bez adaptera i bez automatycznych wywołań. Nie używać kluczy demonstracyjnych do produkcyjnego pozyskiwania. |
| Niemcy — Handelsregister / Unternehmensregister | Dostęp do portalu publicznego nie oznacza licencji na automatyczne masowe pobieranie ani darmowego API do całego rejestru. Brak potwierdzonego odpowiedniego bezpłatnego API w tym etapie. | Bez scrapingu, obchodzenia CAPTCHA i automatyzacji portalu. Potrzebne osobne uzgodnienie źródła/open data. |
| Holandia — KVK | Dostęp API podlega produktom/warunkom KVK; nie potwierdzono odpowiedniego bezpłatnego zakresu dla tego pilota. Nie zakładamy, że publiczna wyszukiwarka jest otwartym zbiorem. | Bez płatnych API i bez scrapingu; osobna decyzja po sprawdzeniu aktualnych warunków. |

## Norwegia — źródła pierwotne

- API: https://data.brreg.no/enhetsregisteret/api/enheter
- Dokumentacja: https://data.brreg.no/enhetsregisteret/api/docs/index.html
- Oficjalny historyczny OpenAPI: https://github.com/brreg/openAPI/blob/master/specs/enhetsregisteret.json
- Repozytorium sprawdzono przez Git, w tym `info.license.name = Norsk lisens for
  offentlige data (NLOD)` i URL https://data.norge.no/nlod/no/.
  **Nie przypisujemy automatycznie numeru wersji licencji.**
- Warunki aktualnego API/danych należy potwierdzić u Brreg:
  https://www.brreg.no/produkter-og-tjenester/apne-data/
- Odczytano oficjalne repo `brreg/openAPI`, HEAD
  `97fccebaafc4f870028d7bc4748629b16b9d54af` (17.01.2025). JSON ma
  `info.version=1.0.0`, a opis zawiera changelog 2018. Data HEAD repo nie oznacza
  aktualizacji każdego kontraktu. [Przypięty plik](https://github.com/brreg/openAPI/blob/97fccebaafc4f870028d7bc4748629b16b9d54af/specs/enhetsregisteret.json).
- Odczytano też oficjalne `brreg/docs`, HEAD
  `26ab07c64ab08a156a6ce7a56ee1d455691d98ce` (29.09.2026).
  [Strona Enhetsregisteret](https://github.com/brreg/docs/blob/26ab07c64ab08a156a6ce7a56ee1d455691d98ce/content/apidokumentasjon/enhetsregisteret/_index.md)
  jest wprost oznaczona jako wstępna/ilustracyjna i odsyła do
  [oficjalnego katalogu](https://data.norge.no/datasets/68d08f28-a16d-4fab-a953-ed4ab08ce2e2).
  Katalog również zablokował proxy. Nie traktujemy daty repo jako dowodu licencji 2026.

### Filtry i format — dokładny poziom potwierdzenia

Historyczny oficjalny schemat dokumentuje `naeringskode` na dowolnym poziomie
klasyfikacji, listę form `organisasjonsform` oddzielaną przecinkami, `konkurs`,
`underAvvikling`, `size`, `page` i `sort`; głębokość `page*size` opisano jako
10 000. Nazwy parametrów V1 są z tym zgodne. Nie jest to test ich przyjęcia dzisiaj.

Udokumentowano pola `organisasjonsnummer`, `navn`, `organisasjonsform`,
`naeringskode1/2/3` i flagi statusu. Kolekcja 200 ma jednak ogólny schemat
`application/json`/`string`. Ten plik **nie potwierdza formalnie** struktury
`_embedded.enheter`, `forretningsadresse.poststed`, `hjemmeside` ani pustej strony
używanych przez adapter. Potrzebna jest mała odpowiedź z obecnego API i OpenAPI.

NLOD wskazano w źródle historycznym; aktualnej wersji i przypisania licencji do
konkretnej dystrybucji nie odczytano. Przed aktywacją utrwalić aktualny dokument,
datę, zasady atrybucji i ponownego użycia komercyjnego. Licencja nie potwierdza
posiadania towaru, umocowania reprezentanta ani zgody na wysyłkę handlową.

Przy ponownym wykorzystaniu zachowaj nazwę źródła, link do rekordu i datę
pozyskania (workflow to zapisuje); aktualny obowiązek atrybucji/brzmienie licencji
potwierdź przed udostępnieniem lub dalszym przetwarzaniem. Rejestr nie dowodzi
umocowania aplikanta, wiarygodności handlowej ani posiadania towaru.

NO używa identyfikatora organizacyjnego 9 cyfr, tylko AS/ASA. Branżę zapisujemy
tak, jak zwraca źródło; nie deklarujemy zgodności wersji SN/NACE między krajami.
Kod branży i prywatny URL nie zastępują ręcznej kwalifikacji kandydata.

## Czechy — źródła pierwotne i pomocnicze

- ARES: https://ares.gov.cz/
- Informacje dla developerów / zasady: https://ares.gov.cz/stranky/vyvojar-info
- Swagger: https://ares.gov.cz/swagger-ui/
- API: https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty
- Kontrola pomocnicza schematu: pakiet npm `@czagents/ares@0.1.10`, plik
  `dist/client.js` i deklaracje typów. **To nie jest oficjalne źródło warunków danych.**
  Licencja kodu SDK (MIT) nie przyznaje licencji do danych ARES; kod SDK nie został
  dołączony, zainstalowany jako zależność ani użyty podczas wykonania workflow.

Przed aktywacją sprawdź w oficjalnych warunkach dopuszczalność selekcji firm do
prywatnego pilota, ograniczenia ponownego udostępniania, wymagane oznaczenia
źródła i bieżące limity. Nie podajemy niezweryfikowanego limitu „żądań/minutę”.
Workflow ma znacznie niższy własny limit (zwykle 1 zapytanie/kraj/noc) i respektuje
Retry-After, ale własny niski limit nie zastępuje warunków dostawcy.

CZ: ICO 8 cyfr, formy `112` i `121`; brak WWW w obsługiwanym schemacie daje `null`.
Paginacja `start`/`pocet`, filtr `czNace` i `pravniForma` wymagają aktualnego testu
oficjalnego API. Nie dorabiamy adresów ani danych reprezentantów z innych portali.

Na 24.10 nie potwierdzono, czy dwucyfrowe `czNace` działa jako prefiks, jak wygląda
pusta odpowiedź, jaka wersja klasyfikacji obowiązuje i jakie są obecne limity.
Obecny parser oczekuje `ekonomickeSubjekty[]`, string ICO, `obchodniJmeno`,
`pravniForma`, `sidlo.nazevObce`, `czNace[]` oraz opcjonalnego `datumZaniku`.
To **nie jest weryfikacja względem rzeczywistej odpowiedzi ARES**. Licencja MIT
pomocniczego SDK nie jest licencją danych rejestru. Zgoda CZ nadal `false`.

## Norwegia — CSV/JSON i aktualizacje przy przyszłej skali

| Element | Dowód / stan |
| --- | --- |
| Zbiór Enhetsregisteret w oficjalnym katalogu | Link potwierdzony w oficjalnej dokumentacji Brreg; metryka katalogu niedostępna z tego środowiska |
| Pełne pliki CSV i JSON | Nie potwierdzono aktualnych URL, formatu, nagłówków, kompresji, rozmiaru, częstotliwości ani licencji dystrybucji. Nie pobierano pełnych zbiorów |
| `/oppdateringer/enheter` | Udokumentowane w oficjalnym historycznym OpenAPI: parametry `dato` (czas ISO), `oppdateringsid` i `organisasjonsnummer`; obecne semantyki, retencja i format zdarzeń wymagają potwierdzenia |
| V1 | Przyjmuje tylko małe kolekcje HAL/ARES; nie ma parsera CSV, bulk JSON, synchronizacji lub obsługi usunięć |

Proponowany **późniejszy, niezaimplementowany** przebieg:

1. Potwierdzić metrykę dystrybucji, prawo ponownego wykorzystania, wersję
   SN/NACE, aktualność i punkt graniczny snapshotu. Nie zgadywać endpointów
   pobierania na podstawie samej nazwy pliku lub starego schematu.
2. Pobrać jeden zatwierdzony snapshot do prywatnego katalogu roboczego, ze
   sprawdzeniem miejsca i limitu rozmiaru przed pobraniem/rozpakowaniem.
   Zapisać URL, czas źródła/pozyskania, hash i wersję formatu. Bez danych w Git.
3. Czytać strumieniowo; numery rejestrowe jako tekst (z zachowaniem zer),
   selekcja spółek/sektorów, tylko potrzebne pola firmowe. CSV nie trafia
   bezpośrednio do istniejącego adaptera ani do całej tabeli n8n.
4. Dopiero po potwierdzeniu kontraktu zmian: trwały cursor, idempotentny replay,
   wykrywanie przerw i oznaczenie usunięć/likwidacji do przeglądu. Nie utożsamiać
   czasu pozyskania z aktualnością rekordu i nie zakładać spójności snapshot/feed.
5. Zachować limit V1 **50 nowych/dzień i 500 firm**; większy snapshot nie oznacza
   większego importu. Skala wymaga osobnej decyzji o przechowywaniu/retencji,
   bez drugiego CRM. OWNER VAULT V3 pozostaje osobnym, nieaktywnym kontraktem.

Pełny snapshot może być oszczędniejszy od wielokrotnego stronicowania, ale nie
stanowi działającej ani zatwierdzonej funkcji tego pilota. Żaden harmonogram,
endpoint aktualizacji, importer ani zapis do OWNER VAULT nie został włączony.

## Pozostałe kraje — punkty dalszej weryfikacji

- GUS BIR: https://api.stat.gov.pl/Home/RegonApi
- Handelsregister: https://www.handelsregister.de/
- Unternehmensregister: https://www.unternehmensregister.de/
- KVK Developer Portal: https://developers.kvk.nl/
- Otwarte dane NL: https://data.overheid.nl/

Nie podajemy niepotwierdzonych aktualnych opłat ani gwarancji darmowego dostępu.
V1 nie wywołuje tych źródeł. Każdy nowy adapter wymaga źródła, licencji, stabilnego
klucza, testów oraz oddzielnego zatwierdzenia. Brak danych to brak wyniku, nie
fikcyjna firma.
