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
