# ShadowBridge MVP — uruchomienie i bezpieczna obsługa

Ten etap jest środowiskiem **lokalnym do przeglądu i testów**, z rzeczywistym GoTrue Auth, PostgreSQL i politykami dostępu. Nie jest wdrożeniem produkcyjnym ani certyfikatem bezpieczeństwa. Nie skonfigurowano kont zewnętrznych usług, prawdziwego SMTP, płatnych usług ani automatycznego importu rzeczywistych danych. Produkcja GitHub Pages i DNS pozostają bez zmian.

## Najkrótsza instrukcja lokalna

Wymagania: Linux, działający Docker z Compose v2, Node.js 22.12 lub nowszy oraz npm. Polecenia wykonuj w katalogu repozytorium, na gałęzi `feature/secure-b2b-mvp`.

```bash
npm ci
npm run dev:up
npm run dev:server
```

Jeżeli środowisko ogranicza zapis do domyślnego cache npm, użyj `npm ci --cache /tmp/shadowbridge-mvp-npm`. Pierwsze uruchomienie pobiera trzy przypięte do digestów obrazy: PostgreSQL 17, Supabase GoTrue i Mailpit. Nie pobiera ani nie wysyła rzeczywistych danych biznesowych.

- Aplikacja oraz serwerowe API: <http://127.0.0.1:8088/>.
- Lokalna skrzynka testowa Mailpit: <http://127.0.0.1:8025/>.
- GoTrue: `127.0.0.1:9999`; PostgreSQL: `127.0.0.1:54322`.
- Wszystkie opublikowane porty Dockera i lokalny serwer HTTP są przypisane do loopback. Nie są udostępniane sieci lokalnej ani Internetowi.

Rejestrację testuj wyłącznie fikcyjnymi danymi, np. losowym adresem w domenie `shadowbridge.invalid` i osobnym losowym hasłem. Wiadomości weryfikacyjne i odzyskiwania hasła trafiają do Mailpit, **nie do Gmaila ani rzeczywistego odbiorcy**. Kliknięcie linku potwierdza adres w prawdziwym lokalnym GoTrue; nie zatwierdza firmy i nie przyznaje prywatnego dostępu. Formularzy nie uruchomisz przez dwuklik HTML — wymagają lokalnego serwera.

Do zatrzymania aplikacji użyj Ctrl+C, następnie:

```bash
npm run dev:down
```

Zatrzymanie zachowuje wolumen bazy. Ponowne `npm run dev:up` zachowuje istniejące dane, sprawdza sumy zastosowanych migracji i stosuje wyłącznie nowe migracje. Zmieniona zastosowana migracja powoduje błąd; nie jest automatycznie przepisywana. Nie dodano polecenia automatycznego kasowania bazy. Nie usuwaj wolumenu ani katalogu `.local`, jeżeli chcesz zachować konta i sesje.

## Sekrety i lokalne konta administracyjne

Pierwsze uruchomienie generuje silne, losowe hasła ról bazy, sekret GoTrue JWT, klucz szyfrowania sesji i klucz lokalnego klienta Auth. Zapisuje je wyłącznie w ignorowanym `.local/development.env` (plik `0600`, katalog `0700`). Nie kopiuj tego pliku do publicznych paczek, GitHuba, wiadomości ani zgłoszeń. `.env.example` zawiera tylko nazwy ustawień i puste pola sekretów. Nie ma wspólnego hasła demonstracyjnego w repozytorium.

Przeglądarka otrzymuje niejawny identyfikator sesji w ciasteczku HttpOnly, SameSite=Lax; JWT i token odświeżania pozostają zaszyfrowane na serwerze. Produkcja wymaga także Secure i prefiksu `__Host-`. Krótkotrwała sesja odzyskiwania hasła trwa maksymalnie 15 minut i nie daje dostępu do prywatnych funkcji. Zmiana hasła unieważnia sesje aplikacji. Operacje modyfikujące wymagają zgodnego Origin oraz tokenu CSRF.

Uprawnienie zarządcze przyznaje operator bazy dopiero po zweryfikowanej rejestracji. Nie jest przyznawane przez formularz, rolę użytkownika ani członkostwo C.A.R.T.E.L. Do testu lokalnego użyj własnego fikcyjnego, wcześniej zweryfikowanego konta:

```bash
npm run bootstrap:admin -- --email=owner-test@shadowbridge.invalid --grant-management
```

To polecenie nie tworzy hasła, nie wysyła zaproszenia i nie omija MFA. Działania zarządcze wymagają osobnego, rzeczywistego TOTP i sesji `aal2`. Nie przyznawaj tego uprawnienia kupującemu, dostawcy ani partnerowi. Polecenie ma dostęp DBA; nie uruchamiaj go automatycznie ani w publicznym serwerze aplikacji.

## Weryfikacja uprawnień przed wyborem zarządzanej bazy

Migracje przetestowano na lokalnym PostgreSQL 17, uruchamiane przez lokalnego superużytkownika. **Nie przetestowano ich na zarządzanym projekcie Supabase ani u innego dostawcy**; nie skonfigurowano takiego projektu ani jego danych dostępowych. Lokalny wynik nie oznacza gotowej zgodności wdrożeniowej z usługą zarządzaną.

Migracja `001` tworzy wewnętrzną rolę `shadowbridge_policy NOLOGIN BYPASSRLS` jako właściciela ściśle ograniczonych funkcji `SECURITY DEFINER`. Ta rola nie jest kontem aplikacji. `shadowbridge_api` oraz `shadowbridge_sessions` muszą pozostać `NOSUPERUSER NOBYPASSRLS`, bez członkostwa w roli polityk, bez praw zarządzania rolami i bez własności tabel lub schematów biznesowych. Nie wolno zastępować tych połączeń tokenem `service_role` ani połączeniem DBA w celu obejścia błędu migracji.

W PostgreSQL 17 samo `CREATEROLE` nie wystarcza do nadania `BYPASSRLS`: wykonawca potrzebuje `SUPERUSER` albo własnego atrybutu `BYPASSRLS`. Dokumentacja Supabase opisuje `postgres` jako rolę z `BYPASSRLS`, dlatego brak `SUPERUSER` sam w sobie nie przesądza o niezgodności. Konkretny projekt może jednak ograniczać tworzenie ról, ich członkostwa lub zmianę właściciela. Operator musi sprawdzić rzeczywiste uprawnienia u wybranego dostawcy.

Poniższe zapytania są tylko do odczytu; wykonuje je operator na **osobnej bazie testowej dostawcy**, po uruchomieniu Auth. Nie zawierają haseł ani danych kontrahentów:

```sql
SELECT current_user, rolsuper, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname = current_user;

SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS create_schema,
       has_schema_privilege(current_user, 'auth', 'USAGE') AS auth_schema_usage,
       has_table_privilege(current_user, 'auth.users', 'SELECT') AS auth_users_read,
       has_table_privilege(current_user, 'auth.users', 'TRIGGER') AS auth_users_trigger;

SELECT name, installed_version FROM pg_available_extensions WHERE name = 'pgcrypto';

SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolbypassrls
FROM pg_roles
WHERE rolname IN ('shadowbridge_api', 'shadowbridge_sessions', 'shadowbridge_policy');

SELECT rolname,
       pg_has_role(current_user, oid, 'SET') AS can_set_policy_role,
       pg_has_role(current_user, oid, 'USAGE') AS inherits_policy_ownership
FROM pg_roles WHERE rolname = 'shadowbridge_policy';
```

Brak wiersza dla roli przed jej utworzeniem jest oczekiwany. Dla wykonawcy bez `SUPERUSER` trzeba także zapewnić uprawnienia do przekazywania własności funkcji i późniejszego zastępowania funkcji należących do roli polityk. `ALTER FUNCTION ... OWNER TO shadowbridge_policy` wymaga, aby nowy właściciel miał `CREATE` w schemacie `sb`. Migracja `001` przyznaje je tymczasowo i potem odbiera; migracje `002` i `004` również przekazują własność nowych funkcji. Lokalny superużytkownik przechodzi te operacje, ale zwykły administrator usługi zarządzanej może otrzymać odmowę. Sam atrybut `BYPASSRLS` nie omija tych wymagań DDL.

Przed wdrożeniem zewnętrznym należy przygotować i przetestować procedurę dostawcy: kontrolowane utworzenie ról, właściwe prawa administratora do własności funkcji, tymczasowe `CREATE` dla roli polityk podczas wymaganych operacji i odebranie go po nich. Administrator potrzebuje również obsługi `pgcrypto`, odczytu `auth.users` oraz utworzenia na nim wyzwalacza synchronizacji. Schematy `sb` i `portal` nie mogą zostać udostępnione przez publiczny Data API/PostgREST; dostęp użytkowników prowadzi przez BFF i ograniczone role bazy. Próba na pustej bazie i ponowny start z rejestrem sum migracji muszą przejść razem z testami uprawnień. **Takiej procedury dla usługi zarządzanej jeszcze nie zatwierdzono ani nie przetestowano.**

Jeżeli dostawca nie pozwala utworzyć tej roli lub odpowiednio przekazać własności, obecnych migracji nie należy uruchamiać na rzeczywistych danych. Wtedy potrzebna jest osobno przejrzana procedura DBA albo migracja adaptacyjna. Możliwy wariant to wewnętrzna rola `NOLOGIN NOBYPASSRLS` z wyraźnymi politykami RLS przeznaczonymi tylko dla funkcji oraz odpowiednimi grantami. Wymaga on analizy rekurencji polityk, wyzwalaczy i kompletnego ponownego testu odmów; nie został tutaj zaimplementowany. Nie zmieniono istniejących migracji ani nie osłabiono RLS.

Źródła: [PostgreSQL 17 — CREATE ROLE](https://www.postgresql.org/docs/17/sql-createrole.html), [ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html), [Supabase — role bazy](https://supabase.com/docs/guides/database/postgres/roles), [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Zasady `BYPASSRLS` potwierdzono również w oficjalnym źródle dokumentacji PostgreSQL 17; nie są wynikiem testu konta Supabase.

## Testy

Przy działającym stosie lokalnym i serwerze aplikacji:

```bash
npm run test:api
```

Testy używają fikcyjnych kont i lokalnej poczty. Nie zastępują przeglądu wdrożenia, testu penetracyjnego, analizy prawnej ani zatwierdzenia pracy na rzeczywistych danych. Wyniki i ograniczenia opisuje osobny raport w dokumentacji.

## Warunki wymagające osobnego zatwierdzenia przed uruchomieniem zewnętrznym

1. **Dostawcy i budżet:** wybór środowiska aplikacji/BFF, bazy PostgreSQL, Auth, prywatnego magazynu dokumentów i SMTP wraz z regionem, umowami powierzenia, limitami i cenami. Nie aktywowano żadnego abonamentu.
2. **Adresy HTTPS:** docelowy adres aplikacji i API, dokładna lista dozwolonych adresów potwierdzania/odzyskiwania oraz konfiguracja reverse proxy. `APP_ENV=production` wymaga HTTPS dla aplikacji i Auth oraz `sslmode=verify-full` dla bazy. Nie zmieniaj istniejących DNS i GitHub Pages przed odrębną zgodą. Sam GitHub Pages nie uruchamia tego BFF ani PostgreSQL.
3. **Poczta:** zweryfikowany nadawca i domena SMTP, wymagane SPF/DKIM/DMARC, szablony oraz limity wysyłania. Hasło aplikacji Gmail nie jest automatycznie używane; nie udostępniaj hasła głównego Gmail. Mailpit jest narzędziem lokalnym i nie może być publiczną pocztą produkcyjną.
4. **Baza i sekrety:** uruchomienie migracji jako osobny DBA; połączenie aplikacji wyłącznie jako `shadowbridge_api`, sesji jako `shadowbridge_sessions`. Żadna rola wykonawcza nie może mieć SUPERUSER/BYPASSRLS. Rola polityk pozostaje NOLOGIN. Dane migracji/DBA i provider service-role nie trafiają do aplikacji publicznej. Sekrety w menedżerze sekretów; rotacja klucza sesji wymaga wylogowania istniejących sesji.
5. **Rejestracja i firmy:** zweryfikowany adres nie oznacza zatwierdzenia konta biznesowego. Ręczna decyzja zarządu, odpowiednia rola, aktywne konto i przydział konkretnej możliwości pozostają wymagane. Dane poufne oraz powiązania kontrahentów są po stronie serwera i chronione RLS.
6. **Dokumenty:** przed przyjęciem prawdziwych plików potrzebne są prywatny magazyn, kwarantanna, antymalware, OCR/analiza metadanych, anonimizacja i ręczne zatwierdzenie. Brak tego procesu oznacza brak przyjmowania i publikacji plików. Publiczny opis musi być sprawdzony; automatyczna detekcja nie gwarantuje usunięcia wszystkich identyfikatorów.
7. **Monitoring i ograniczenia:** współdzielone limity prób dla wielu instancji BFF, ochronę przeciw automatyzacji, alerty, prywatną retencję logów i nadzór nad zdarzeniami bezpieczeństwa należy skonfigurować przed produkcją. Obecny limit BFF jest w pamięci jednej instancji. Logi nie mogą zawierać haseł, tokenów, plików ani danych kontrahentów; audyt zapisuje zdarzenia i kontrolowane wewnętrzne identyfikatory.
8. **Kopie i odzyskiwanie:** ustalenie RPO/RTO, zaszyfrowane kopie bazy i prywatnego magazynu, ograniczone uprawnienia do kopii, rotacja/retencja oraz udokumentowany test odtworzenia. Wolumen Dockera zapewnia lokalną trwałość, ale nie jest kopią zapasową. Kopii bazy i sekretów nie zapisuj w Git ani w paczce publicznego podglądu.

Nie podłączono zewnętrznego hostingu, rzeczywistego SMTP ani usług skanowania dokumentów. Nie wprowadzono prawdziwych kontrahentów. Przed dopuszczeniem takich danych konieczne są odrębna decyzja właściciela, przygotowanie powyższych elementów i test całego docelowego środowiska.
