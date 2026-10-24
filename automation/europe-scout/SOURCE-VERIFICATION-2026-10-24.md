# European Scout V1 — weryfikacja 24.10.2026

**Status: BLOCKED — aktualne źródła/warunki niepotwierdzone do aktywacji.**
Gałąź `feature/european-b2b-scout-v1`, baza `f37f2a7`.

## Potwierdzone

- Oficjalne repo Brreg `openAPI` (HEAD 97fcceba…) wskazuje adres API, historyczne
  filtry oraz NLOD. Parametry zapytania NO są zgodne z tym schematem.
- Oficjalne repo `brreg/docs` (HEAD 26ab07c6…, 29.09.2026) odsyła do katalogu
  Enhetsregisteret; jego strona API jest wstępna, nie jest aktualnym pełnym kontraktem.
- **5 celowanych testów PASS**: zgodność JSON z generatorem i wyłączone źródła,
  identyfikatory/kraje, jawny WWW, brakujące dane oraz odrzucanie nieprawidłowych
  ID/osób fizycznych/statusów uwzględnionych w V1. Są to fikcyjne odpowiedzi.
  Nie powtarzano pełnych 18 testów ani 8 prób na rzeczywistym lokalnym n8n.

## Blokady i granice

Wykonano próbę GET NO i POST ARES, po maks. jednym wyniku, oraz odczyty oficjalnej
dokumentacji. Proxy odrzuciło CONNECT: 403/Envoy, `curl 56`, HTTP źródła `000`.
Zwykłe ponowienie poza sandboxem dało ten sam wynik. Żaden rejestr nie zwrócił
odpowiedzi ani firmy; nie jest to błąd 403 otrzymany z API. Nie obchodzono blokad.
Oficjalne warunki Brreg i katalog data.norge również pozostały niedostępne.

Nie potwierdzono obecnych licencji, limitów, wersji klasyfikacji ani zgodności
adapterów z **rzeczywistą** odpowiedzią. Dla ARES nadal mamy tylko pomocniczy SDK,
nie aktualne oficjalne OpenAPI. Nie potwierdzono dystrybucji CSV/JSON i harmonogramu
odświeżania. Nie pobierano pełnych zbiorów ani nie publikowano danych firm.

## Konieczne sprawdzenia/poprawki przed aktywacją

1. Pozyskać legalny dostęp do obecnej dokumentacji, warunków i małej odpowiedzi
   każdego API; potwierdzić media type, paginację, prefiksy kodów, puste wyniki
   i mapowanie pól. Dopiero na tym oprzeć ewentualne zmiany adapterów.
2. **Luka NO:** pole `underTvangsavviklingEllerTvangsopplosning` jest w oficjalnym
   schemacie, lecz V1 go nie sprawdza. Próba z fikcyjnym rekordem i tą flagą
   dodała 1 kandydata (`unconfirmed`/`review_required`, bez zatwierdzenia firmy).
   Przed aktywacją trzeba ustalić wykluczenie lub osobny przegląd takiego sygnału
   i dodać test. Nie zmieniono teraz zasad kwalifikacji ani kodu adaptera.
3. Syntetyczny pusty HAL bez `_embedded` powoduje `schema_error` i blokadę źródła.
   Nie wiadomo, czy obecny Brreg rzeczywiście tak odpowiada. Potwierdzić pustą
   stronę w kontrakcie; nie oznaczać tej próby jako testu rzeczywistego błędu API.
4. Masowe CSV/JSON, cursor aktualizacji i obsługa usunięć są przyszłym zakresem,
   opisanym w [SOURCES](SOURCES.md). V1 nie jest importerem całego rejestru.

## Następny krok i ograniczenia

Operator z legalnym dostępem do źródeł potwierdza warunki i minimalny kontrakt
odpowiedzi; potem OWNER zatwierdza mały etap poprawek/testów przed pilotem.
Nie przenosić tego sprawdzenia na Contabo ani do OWNER VAULT. Surowe próbki,
jeśli zostaną pozyskane, pozostają poza publicznym repo.

Dodano wyłącznie dokumentację, w tym osobny
[SCOUT SURPLUS & LIQUIDATIONS](SURPLUS-LIQUIDATIONS-ROADMAP.md).
Pilot producentów zachowano. Workflow, harmonogram, tabela pilota, zgody NO/CZ
i kontrakt OWNER VAULT pozostały niezmienione/nieaktywne. Bez nowych funkcji,
importów, usług, wiadomości lub zmian Contabo.

Metadane bez rekordów firm: [SOURCE-VERIFICATION.json](SOURCE-VERIFICATION-2026-10-24.json).
