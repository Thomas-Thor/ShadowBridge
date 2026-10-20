# Dashboardy — lokalna weryfikacja UI

20.10.2026. Zakres: frontend na `feature/secure-b2b-mvp`, baza `6594633`.
Bez zmian backendu, SQL, danych, publicznej witryny i infrastruktury.

## Etap C

Chromium: **4/4 zaliczone**, bez pominięć. Sprawdzono układ przy 1440/390/320 px,
klawiaturę, axe WCAG A/AA w obszarze panelu, istniejący formularz RFQ, stany braku
backendu/oczekiwania/MFA oraz czyszczenie treści i sidebaru po zmianie sesji.
Ograniczony transport statyczny odrzuca API, sekrety i pliki repozytorium.

To testy **prezentacji na jawnie fikcyjnych DTO przechwytywanych w teście**,
nie nowe testy prawdziwego logowania, PostgreSQL ani uprawnień backendu.
Nie dodano do aplikacji zastępczego logowania ani trybu fikcyjnego backendu.
Wyniki rzeczywistej regresji backendu są osobno w `regression-2026-10-20.md`.

Uruchomienie testów UI z istniejącym Playwright/Chromium, bez instalacji zależności:

```sh
node /workspace/ShadowBridge/v2/node_modules/@playwright/test/cli.js test -c tests/dashboard.config.cjs
```

Na innym komputerze można użyć własnego zainstalowanego Playwright i ustawienia
`SHADOWBRIDGE_TEST_MODULES` opisanego w `tests/dependencies.cjs`. Serwer testowy
działa wyłącznie na loopback i jest automatycznie zatrzymywany przez runner.

## Przegląd działającego MVP na własnym komputerze

Dotychczasowy `npm run demo` oraz własne lokalne konta pozostają sposobem wejścia
do `/portal/buyer/`, `/portal/supplier/`, `/portal/partner/`, `/portal/admin/`
i `/portal/offers/`. Command Center nadal wymaga rzeczywistego MFA. Sam plik HTML
bez działającego lokalnego MVP nie udostępnia prywatnych danych ani logowania.

## Etap D

Buyer, Supplier i Partner mają podsumowania przed formularzami: KPI odebranych
rekordów, rozkłady statusów, ostatnie zmiany i linki do istniejących działań.
Nie wykonują dodatkowych żądań; dane pochodzą z dotychczasowych odczytów list,
a ponowienie listy po zapisie aktualizuje również podsumowanie. Prowizje są
grupowane według waluty źródłowej, bez konwersji i bez utożsamiania ich z zapłatą.

**4/4 przypadki UI zaliczone**: zapis RFQ aktualizuje 2 → 3, Supplier widzi review
i wyjaśnienia, Partner ma osobne EUR/PLN i brak pozornego zera dla pustej kwoty,
stan pusty różni się od błędu, zmiana sesji usuwa summary. Układy sprawdzono
przy 1440/390/320 px. Dwa selektory testów wymagały dopasowania do pełnej
dostępnej nazwy linku; ponowiono te dwa przypadki, bez osłabiania asercji href.
Po integracji D ponowiono także cztery przypadki wspólnego shell: **4/4**,
w tym axe na nowych widgetach Buyer przy 320 px.

Leady, konwersja/performance, zadania follow-up i unread nie są podłączone.
Podsumowania list mają jawny zakres „loaded records”, maksymalnie 200 pozycji;
licznik anonimowych okazji opisuje dostępny `total` dla bieżących filtrów.

## Etap E

Owner i pracownicy korzystają z monitoringu opartego wyłącznie na istniejącym
`/api/staff/overview`: zwrócone liczniki, rozkład obciążeń kolejek, dozwolone
dalsze działania oraz maksymalnie 12 zdarzeń audytu. Nie pobiera dodatkowych
list firm/ofert. Brak pola nie staje się zerem; zakres dopasowuje się do
efektywnych permissions, również dla Operations i Analyst. Nagłówki i moduły
szczegółowe zachowano; stary renderer pozostaje fallbackiem prezentacji.

**3/3 przypadki UI zaliczone**: Owner i bezpieczna aktywność/axe, Operations
i Analyst bez niedozwolonych kart/linków, wartości `null` oraz błąd usługi bez
fikcyjnych zer i pozostawionej nawigacji. Sprawdzono 1440/390/320 px. Fixture
złośliwego tekstu nie tworzy HTML, a aktywność jest ograniczona do 12 zdarzeń.

Nadal niepodłączone: globalna liczba aktywnych firm, trendy historyczne,
obecność online, zadania, logistyka i rozliczenia. Są oznaczone jako niedostępne,
bez fikcyjnych KPI. Nie dodano modułów Intelligence CRM ani C.A.R.T.E.L.

## Dokumenty i zapisane etapy

- A: `424737f0e7edf6a741bd90cab12df0a1969c09e6` — [audyt i mapa ról](dashboard-audit.md).
- B: `3f5b1aae4d1281eb0f509a8124703a53f8675119` — [system komponentów](dashboard-system.md).
- C: `aa9b1f955a872b126430fab69d005d482637d4b6` — wspólny shell i cztery smoke.
- D: `2e162d8c8a707c8090a7253629186b83fc8e037d` — trzy panele kontrahentów.
- E: commit zawierający niniejsze podsumowanie — monitoring Command Center.

W etapach A/B sprawdzano dokumenty i kod; nie deklarowano nowych testów
funkcjonalnych. A–E nie zmieniają backendu, migracji, danych, zależności,
`main`, publicznej strony, CNAME ani konfiguracji hostingu/DNS.

Po integracji E wykonano jeden końcowy komplet **11/11 testów UI** na tym samym
kodzie: C4 + D4 + E3, bez błędów, pominięć i flaky. Obejmuje również czyszczenie
nowego Overview po zmianie sesji oraz dostępność nowych widgetów. Nie ponawiano
pełnych testów repozytorium ani rzeczywistych testów backendu.
