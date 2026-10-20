# ShadowBridge MVP — wynik implementacji i testów

**Zapis historyczny wcześniejszego wykonania.** Poniższe wyniki nie oznaczają
ponowienia tych testów po każdej późniejszej zmianie. Aktualne wykonania i ich
ograniczenia opisuje [raport regresji z 20.10.2026](regression-2026-10-20.md);
zapis [punktu kontrolnego z 19.10](checkpoint-2026-10-19.md) pozostaje bez zmian.

Data: 19 października 2026. Gałąź `feature/secure-b2b-mvp`, oparta na
`feature/private-b2b-entrypoints` (`2cc4de8`). Produkcyjny `main` pozostaje
`d0512dd`. Nie wdrożono MVP na domenie publicznej.

## Co rzeczywiście działa lokalnie

1. Rejestracja Buyer, Supplier i B2B Partner przez rzeczywiste Supabase GoTrue.
   Hasła obsługuje dostawca Auth. Wiadomość trafia do lokalnego Mailpit;
   potwierdzenie linku tworzy prawdziwą sesję, a aplikacja firmy pozostaje pending.
2. Logowanie, sesja HttpOnly, odzyskanie hasła, ponowne logowanie i wylogowanie.
   Tokeny dostawcy i odświeżania są zaszyfrowane po stronie BFF, bez localStorage.
3. Ręczna akceptacja lub odrzucenie firmy przez upoważniony zarząd z prawdziwym
   TOTP/AAL2. Nie ma publicznego formularza nadawania uprawnień administratora.
4. Supplier: własna firma, utworzenie i edycja szkicu, zgłoszenie oferty do oceny,
   status, prośby o wyjaśnienie i rozmowa z ShadowBridge.
5. Buyer: własna firma, utworzenie/edycja/złożenie RFQ, status, rozmowa
   z ShadowBridge oraz wyłącznie indywidualnie przydzielone anonimowe karty.
6. Partner: profil geograficzny/sektorowy, propozycje, przydzielone projekty
   i rzeczywiście zapisane indywidualne prowizje z referencją umowy.
7. Formularz kontaktu zapisuje zgłoszenia w prywatnej kolejce PostgreSQL.
   Publiczna odpowiedź zawiera wyłącznie numer potwierdzenia. Tylko zarząd z MFA
   odczytuje treść i zmienia status; formularz nie wysyła e-maili.
8. Zarząd: ocena firm/ofert/RFQ/propozycji, wewnętrzne relacje firm, przygotowanie
   osobnej anonimowej karty, przydział konkretnemu odbiorcy, projekty, uzgodnione
   prowizje, zawieszenie konta i odczyt audytu.

Przebiegi wykonano na rzeczywistym PostgreSQL i GoTrue, nie na atrapach API.
Testy tworzą losowe, jawnie fikcyjne firmy i hasła wyłącznie w pamięci procesu.
Dane deweloperskie są w lokalnym wolumenie Dockera, oddzielone od realnego CRM;
nie podłączono Google Sheets ani prawdziwych kontrahentów.

## Dowody testowe

| Zakres | Wynik |
|---|---|
| API/Auth/SQL i poufność | 13 scenariuszy; raport Node 14/14 wraz z testem nadrzędnym |
| Kolejka kontaktu: prawdziwe API/PG/RLS/MFA/audyt/limit | 5 scenariuszy; raport Node 6/6 wraz z testem nadrzędnym |
| Start demonstracji i ponowny start | zaliczone; zachowane losowe konta, MFA i rekordy |
| Konfiguracja produkcyjna/lokalna | 2/2 |
| Walidacja anonimowych treści i danych handlowych | 2/2 |
| Rzeczywiste przepływy mobilne 390/320 px | 4/4 |
| Supplier, administracja i Partner przez desktop UI | 2/2 |
| Kontakt i prywatna kolejka przez UI, CSRF w dwóch kartach, nawigacja 1440/390 px | 6/6 |
| Horus, WhatsApp, statyczne nieaktywne formularze 1440/390/320 px | 6/6; po zmianie etykiety ponowiono tylko 3 odpowiednie przypadki |
| Legal Information oraz axe kontaktu | brak naruszeń, błędów JS i przepełnień w sprawdzonym zakresie |
| Bezpośrednie SQL/RLS | baza GoTrue: dotychczasowe i nowe polityki kolejki zaliczone; wcześniejsze migracje 001–004 sprawdzono także od pustego schematu |

Testy obejmują brak dostępu pending, wymóg potwierdzenia adresu, MFA,
bezskuteczne samonadawanie roli, CSRF/Origin, własne i obce rekordy, brak danych
dostawcy w DTO kupującego, brak dostępu bez przydziału, dwie odrębne rozmowy
firm przy tej samej karcie, zgłoszenia i decyzje, brak domyślnej prowizji,
odzyskanie hasła, natychmiastową blokadę po zawieszeniu i historię audytu.
Odpowiedź sukcesu API jest wysyłana po zatwierdzeniu transakcji PostgreSQL.

Naprawiono odrzucanie `/assets/content.en.js` przez regułę serwowania plików,
co blokowało skrypt strony głównej i formularz. Kontakt po odnowieniu CSRF
w innej karcie pobiera nowy token i ponawia jedynie żądanie jawnie odrzucone
przed zapisem. Test potwierdził dokładnie jeden rekord w bazie. Ujednolicono
widoczny tekst i etykietę dostępności WhatsApp. Nie powtarzano całych zestawów
po poprawkach dotyczących pojedynczych przypadków.

## Publiczna strona i granice wydania

- Stopka używa PNG Oka Horusa z przezroczystością na czarnym tle, bez ramki;
  link pozostaje dostępny klawiaturą i prowadzi do istniejącego `/cartel/`.
- Przygotowany link WhatsApp używa przekazanego numeru `+47 47747007`.
  Nie pokazujemy numeru jako osobnego tekstu strony. Adres `wa.me` z definicji
  ujawnia numer docelowy. Nie sprawdzano rejestracji WhatsApp Business i nie
  uruchomiono automatycznego wysyłania wiadomości.
- Strona `/cartel/` i jej komunikat są zachowane. Dotychczasowy Gmail pozostaje
  formalnym kontaktem w `/legal/`, zamiast głównym sposobem wysyłania zapytań.
- SHADOWBRIDGE jest marką THØR NORDIC COMMERCE V/ TROJANOWSKI, 934 957 296,
  ENK, Norway. Konfiguracja współdzieli operatora między markami. Adres rejestrowy
  pozostał poza Git i publicznym kodem, do osobnego zatwierdzenia; brak VAT/MVA.
- Paczka statycznego publicznego podglądu ma 27 plików z zamkniętej listy,
  `noindex, nofollow` i `robots.txt: Disallow: /`. Nie zawiera portalu,
  account.js, backendu, migracji, sekretów, bazy, testów ani fikcyjnych rekordów.
  Formularze kont i kontaktu pozostają w niej nieaktywne. Nie jest to działająca platforma.

## Co wymaga dalszej konfiguracji lub zatwierdzenia

Demo uruchamia się przez `npm run demo`; losowe dane kont i lokalny sekret MFA
pozostają wyłącznie w ignorowanym `.local/demo-accounts.json` (0600). Zwykłe
nowe rejestracje wymagają ręcznej decyzji, a automatyczne przygotowanie dotyczy
wyłącznie własnych fikcyjnych kont demonstracyjnych.

Brak zewnętrznego projektu Supabase, adresów docelowych HTTPS, rzeczywistego
SMTP/nadawcy, hostingu BFF, kopii zapasowych, monitoringu i produkcyjnego
przetwarzania dokumentów. Nie kupiono żadnych usług. GitHub Pages nie uruchomi
tego backendu. Lokalne testy nie potwierdzają jeszcze konkretnego zarządzanego
projektu Supabase; wymagany jest preflight uprawnień migracyjnych opisany w
`mvp-operations.md` i test konfiguracji docelowego dostawcy.

Nie ma uploadu ani publikacji dokumentów: bez skanowania, OCR/redakcji i ręcznej
akceptacji pliki pozostają poza zakresem. Detektor tekstu zatrzymuje wzorce
kontaktów, domeny, identyfikatory i znane nazwy/rejestracje firm; nie gwarantuje
wykrycia wszystkich sposobów identyfikacji. Każda karta i treść dla partnera
wymaga jawnej oceny upoważnionego zarządu. Oryginały źródłowe nie są wysyłane
kupującym ani innym firmom. Nie zaimplementowano procesu ujawniania tożsamości
ani prywatnego logowania C.A.R.T.E.L.

Przed rzeczywistymi danymi wymagane są osobne zatwierdzenie usług i budżetu,
konfiguracja docelowa oraz przegląd bezpieczeństwa i odtwarzania. Wstępny
budżet małego wdrożenia to 35–85 USD/mies.; aktualne cenniki i wymagany zakres
hostingu/backupów należy potwierdzić. Lokalny stos nie generuje abonamentu.
