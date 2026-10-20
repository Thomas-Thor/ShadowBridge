# Etap A — audyt paneli i mapa ról

Stan kodu: `65946339c60f16d37f4838955d85bbca072c8c05`, 20.10.2026.
To audyt istniejącego interfejsu i kontraktów API, bez uruchamiania nowych testów.
Zakres obejmuje wyłącznie panele lokalnego MVP; publiczna witryna i backend pozostają bez zmian.

## Obecne widoki

| Rola | Co już istnieje | Braki wizualne i potrzebny układ |
|---|---|---|
| OWNER | `/portal/admin/`: osobny Owner Overview, liczniki, ostatnie zdarzenia, moduły kolejek, zespół, indywidualne prawa i limity; MFA dla zarządu i ponowne MFA dla krytycznych działań | Overview jest funkcjonalny, ale ma proste bloki i rozbudowane poziome menu. Potrzebuje hierarchii KPI, grup reakcji i spokojnej osi aktywności; kolejki muszą pozostać w modułach. |
| GENERAL DIRECTOR / CEO | Ten sam Command Center z szerokim zakresem operacyjnym, bez właścicielskich ustawień i mianowania OWNER/dyrektora | Brak osobnego wizualnego kontekstu dyrektora; wspólny Overview powinien pokazywać jego rzeczywisty zakres, bez sugerowania praw właścicielskich. |
| OPERATIONS MANAGER | Overview, projekty, wiadomości/kontakt, wybrane odczyty i audyt; tworzenie przydzielonych projektów | Potrzebuje czytelnego startu operacyjnego z aktywnymi projektami i kolejkami wymagającymi reakcji. Nie ma silnika zadań, logistyki ani rozliczania transakcji. |
| PROCUREMENT MANAGER | Firmy i zgłoszenia, oferty, kwalifikacja dostawcy, weryfikacja źródła i decyzje; `/portal/offers/` | Karty ofert i duży szczegół już istnieją. Należy je zachować i ujednolicić nawigację/statusy z resztą panelu. |
| SALES MANAGER | Kupujący/zgłoszenia, RFQ, anonimowe okazje i indywidualne udostępnienia, komunikacja | Brak zwięzłego podsumowania RFQ i dalszych kroków; obecnie dominują listy i formularze. Nie ma samodzielnego modułu lejka sprzedaży. |
| COMPLIANCE / FINANCE | Wybrane odczyty, kontrole dostawców, prowizje, audyt; decyzje w przyznanych limitach i kontrolowane zatwierdzenia | Wymaga odróżnienia umówionych prowizji od płatności/przychodu oraz czytelniejszych statusów i wyjątków. Nie jest to system księgowy. |
| STAFF / ANALYST | Domyślnie tylko Overview; indywidualne prawa mogą rozszerzać widoki | To nie osobny panel analityczny. Brak dostępu nie może wyglądać jak błąd albo puste globalne statystyki. Pokazywać wyłącznie dopuszczone dane i uczciwy stan ograniczonego dostępu. |
| BUYER | `/portal/buyer/`: własna firma, szkice/edycja/złożenie RFQ, statusy i rozmowy, filtrowane i stronicowane przypisane anonimowe okazje | Brak dashboardu startowego, sum statusów i kolejnych działań. Długi formularz i lista konkurują o miejsce; rozmowy dostępne są przy rekordzie. |
| SUPPLIER | `/portal/supplier/`: własna firma, szkice i edycja ofert, złożenie do oceny, statusy i wyjaśnienia przez rozmowy | Brak syntetycznego podsumowania review i wyróżnienia `clarification_requested`; potrzebne oddzielenie orientacji w pracy od pełnego formularza. |
| B2B PARTNER | `/portal/partner/`: profil, własne propozycje, przypisane projekty, umówione prowizje i indywidualne anonimowe okazje | Najdłuższy widok, bez skrótu projektów/prowizji i dalszych kroków. Nie ma danych o leadach, konwersji ani wydajności handlowej. |

`/portal/` jest obecnie wspólnym wejściem z profilem firmy i linkami do zatwierdzonych ról,
a nie osobnym dashboardem. Wszystkie siedem stanowisk pracowniczych używa jednego
Command Center; backend/RLS oraz przyznane prawa decydują o rzeczywistym dostępie.
Tabela opisuje domyślne role; indywidualne nadania, odmowy i cofnięcia mają pierwszeństwo.
C.A.R.T.E.L. pozostaje oddzielną stroną informacyjną, bez członkostwa i bez praw zarządczych.

## Wspólne słabości interfejsu

- Ciemna kolorystyka, brązowe akcenty i responsywne formularze już istnieją; nie wymagają wymiany marki.
- Brakuje stałej, zwartej nawigacji panelowej, wspólnego nagłówka kontekstu i hierarchii kart.
- Widoki kontrahentów zaczynają się od profilu i długich formularzy; statusy są głównie tekstem przy rekordzie.
- Brakuje wspólnych komponentów KPI, rozkładu statusów, aktywności i następnych działań.
- Offers Workspace ma już karty, filtry, podkategorie, paginację 12/24 i dostępny dialog; zachować te rozwiązania.

## Dane, które rzeczywiście można wykorzystać

| Istniejące źródło | Uczciwy zakres widgetu |
|---|---|
| `/api/session`, `/api/staff/access` | Bieżąca rola, własna firma, kontekst lokalny, zatwierdzenie i wymagania MFA; bez rozszerzania praw. |
| `/api/offers`, `/api/rfqs`, `/api/proposals` | Własne rekordy, statusy, `createdAt`/`updatedAt`; odpowiedź jest ograniczona do 200 rekordów. Licznik/wykres z listy oznacza odebrane rekordy, nie pełny globalny stan. |
| `/api/opportunities` | Tylko indywidualne przydziały: paginacja, `total` i liczniki kategorii w kontekście aktualnych filtrów. Brak publicznego katalogu. |
| `/api/projects`, `/api/commissions` | Przydzielone projekty i umówione kwoty/statusy, do 200 rekordów. Kwoty sumować osobno według waluty; nie interpretować ich jako przychodu ani wymiany walut. |
| `/api/messages` przy konkretnym rekordzie | Istniejąca rozmowa z ShadowBridge. Brak znacznika przeczytania, terminów follow-up i globalnego licznika nowych wiadomości. |
| `/api/staff/overview` | Autoryzowane liczniki oczekujących zgłoszeń/ofert/RFQ/propozycji/kontaktów, aktywnych projektów i kontrolowanych decyzji; do 12 ostatnich zdarzeń, jeśli rola ma `audit.read`. |

Nie ma gotowych danych dla trendów czasowych, wartości obrotu, aktywnych leadów,
konwersji, rentowności, przypisanych zadań ani globalnego licznika aktywnych firm.
Nie należy pobierać poufnych list wyłącznie po to, aby zasymulować taki monitoring.
Stan „brak danych” trzeba oddzielić od „brak uprawnień” i od liczby zero.

## Proponowany podział kolejnych etapów UI

- **Command Center / Overview:** ograniczony prawami start OWNER/dyrektora i pracowników: KPI, kolejki reakcji, dopuszczona aktywność; bez ładowania wszystkich kolejek.
- **Buyer Workspace:** własne RFQ i ich statusy, przypisane okazje, wejścia do istniejących rozmów i działań.
- **Supplier Workspace:** własne oferty, review/wyjaśnienia, dalsze kroki; pełne formularze i historia pozostają dostępne.
- **Partner Workspace:** propozycje, przypisane projekty, prowizje według walut; leady/performance tylko jako jawnie niepodłączony zakres.
- **Admin / Operations Workspace:** istniejące moduły operacyjne pod wspólnym szkieletem; Offers Workspace zachowuje odrębny widok szczegółowy.

Etap A nie wprowadza nowych funkcji biznesowych, endpointów, danych demonstracyjnych ani zmian uprawnień.
