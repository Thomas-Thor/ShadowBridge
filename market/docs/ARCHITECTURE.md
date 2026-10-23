# M1 — architektura i granice

## Punkt wyjścia

Gałąź `feature/shadowbridge-market-m1` pochodzi z zatwierdzonego OWNER VAULT V2 `188cdafd8a91f215fd2c10aa4f893f482cb54564`. Zastany frontend International to statyczne HTML/CSS/JS obsługiwane przez Node BFF z osobnym logowaniem GoTrue, RBAC, PostgreSQL RLS i MFA. Oferty prywatne oraz anonimowe okazje mają różne, chronione kontrakty. Nie nadają się do bezpośredniej publikacji w Market.

Wszystkie zmiany M1 mieszczą się w `market/`. Bez modyfikacji istniejącego HTML, portali, API, ról, migracji, obrazów Docker, Caddy, DNS, n8n lub konfiguracji `.local/`. Obecny Dockerfile i allowlista serwera International nie publikują katalogu `market/`.

## Podział

| Produkt | Charakter | Dostęp w M1 |
| --- | --- | --- |
| Market | Publiczna giełda B2B; przyszła subdomena `market.shadow-bridge.eu` | Wyłącznie lokalna demonstracja |
| International | Selektywne, poufne pośrednictwo | Brak integracji i zmian |
| C.A.R.T.E.L. | Indywidualnie zapraszana sieć strategiczna | Brak integracji i zmian |
| OWNER VAULT | Prywatny CRM, rzeczywisty OWNER + MFA | Brak integracji i zmian |

Market nie korzysta z prywatnych ofert, danych prywatnego CRM, wyników Scouta, ciasteczek uwierzytelniania ani endpointów `/api`. Fikcyjne dane w M1 są jawne z definicji; nie ukrywamy prywatnych pól w CSS. Publiczny profil fikcyjnego dostawcy nie zmienia zasad anonimowości International. Nie weryfikowano ani nie zmieniano przypisania roli istniejącego konta OWNER.

## Struktura

- `public/`: jedyny katalog do serwowania; samodzielny frontend ES modules, bez frameworka i kompilacji.
- `assets/app.js`: cztery funkcje widoków, routing History API, menu, dialog i filtrowanie. Adres URL przechowuje kryteria oraz stronę; działają odświeżanie i przyciski Wstecz/Dalej.
- `assets/catalog.js`: tylko jawnie fikcyjne firmy/oferty i czyste funkcje wyszukiwania. 9 ofert na stronę. M1 filtruje 18 rekordów w pamięci; to nie jest rozwiązanie skalowania rzeczywistej giełdy.
- `assets/en.js`: angielska baza wspólnych komunikatów, `Intl.NumberFormat` i daty; język dokumentu `en`. Klucze klasyfikacji, ISO walut i krajów nie zależą od języka. Kolejne tłumaczenia wymagają również przeniesienia pozostałych tekstów szablonów i treści do słowników. M1 nie oferuje pozornego przełącznika języków.
- `data/taxonomy.json`: odtwarzalny eksport istniejącego seeda, bez połączenia z bazą.
- `scripts/preview.mjs`: serwer podglądu GET/HEAD, tylko loopback, publiczna allowlista, CSP, noindex; brak endpointów zapisujących i sekretów.
- `scripts/illustrations.mjs`: własne wektorowe ilustracje kategorii, poszczególnych produktów i sieci handlowej. Bez pobierania cudzych zdjęć; materiały oznaczone jako DEMO.

Paleta wymagana przez właściciela: `#F7F9FC`, `#14253D`, `#087F8C`, `#2563EB`, `#E7EDF3`, `#FFFFFF`. Drobny tekst na przyciemnionym tle używa ciemniejszego wariantu teal `#076975`, aby zachować kontrast. Bez zewnętrznych fontów, analityki, reklam, bibliotek runtime i połączeń do usług zewnętrznych.

## Granica późniejszego wdrożenia — nieaktywna

Frontend zakłada samodzielny origin i ścieżki od `/`. Przyszły hosting statyczny musi kierować `/`, `/offers/`, `/offers/:id/`, `/suppliers/:id/` do `index.html`, a zasoby do odpowiednich plików. Lokalny serwer robi to już teraz. Nie utworzono konfiguracji subdomeny ani infrastruktury.

Przed prawdziwymi użytkownikami potrzebne są: osobny kontrakt publicznych ofert i zgód publikacyjnych, backend Market, uwierzytelnianie i uprawnienia, moderacja, bezpieczne pliki, wysyłka wiadomości, polityka prywatności/retencja, wymagania operatora i właściwej jurysdykcji, wyszukiwanie oraz paginacja serwerowa. Brak automatycznego dostępu do International/C.A.R.T.E.L. i brak współdzielenia OWNER VAULT. Decyzje o cenach i usługach płatnych pozostają poza M1.

M1 nie stanowi potwierdzenia gotowości prawnej, bezpieczeństwa produkcyjnego ani zgodności całej przyszłej usługi z WCAG. Noindex i dane DEMO pozostają włączone. Nie wdrażać tej gałęzi istniejącym instalatorem International.
