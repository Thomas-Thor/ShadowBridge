# Źródła i ograniczenia — stan sprawdzenia 23.10.2026

**Nie jest to potwierdzenie aktualnej licencji każdego źródła ani porada prawna.**
Oficjalne API i strony z warunkami NO/CZ zwróciły w tym środowisku 403 z proxy,
również po ponowieniu poza sandboxem. Nie wykonywano obejść, rotacji IP ani
scrapingu. Nie otrzymano próbki rzeczywistych firm; nic takiego nie trafia do Git.
Flagi źródeł w dostarczonym workflow są `false` do potwierdzenia dostępu i warunków.

| Kraj / źródło | Ustalenia i model dostępu | Decyzja V1 |
|---|---|---|
| Norwegia — Brønnøysundregistrene | Publiczny Enhetsregisteret ma REST `/enheter`, filtry branży i formy prawnej, paginację. Oficjalny schemat dostępny w repozytorium Brreg wskazuje NLOD; jest historyczny (2018), nie dowodzi obecnych limitów ani wersji klasyfikacji. | Adapter gotowy; bieżący odczyt i warunki wymagają potwierdzenia. Bez klucza API w workflow. |
| Czechy — ARES, Ministerstvo financí | Wyszukiwanie POST `/ekonomicke-subjekty/vyhledat`, ICO jako identyfikator, CZ-NACE, forma prawna, siedziba. Format zgodny z dostępnym SDK, ale SDK jest źródłem pomocniczym, nie umową licencyjną. | Adapter gotowy; aktualne warunki ponownego wykorzystania, limity i format zapytania wymagają potwierdzenia u operatora. |
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
