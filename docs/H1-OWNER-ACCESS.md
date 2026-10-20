# H1 — pierwsze konto OWNER na prywatnym stagingu

Procedura do wykonania przez właściciela po aktualizacji stagingu. Nie wykonano
jej na Contabo z tego środowiska. Nie zakłada istnienia kont demo. Korzysta z
normalnej rejestracji, potwierdzenia GoTrue i rzeczywistego kodu MFA.

## 1. Warunki przed utworzeniem rzeczywistego konta

- Tunel prowadzi do właściwego serwera; `https://localhost:8443` ma sprawdzony
  certyfikat. Nie ignoruj błędu certyfikatu i nie otwieraj niezabezpieczonego HTTP.
- Hasło `reviewer` chroni tylko prywatny staging. Nie jest kontem ShadowBridge
  ani hasłem OWNER. Nie wyłączaj tej bramy podczas testów.
- **Domyślny tryb `captured` wysyła do Mailpit, a nie do skrzynki właściciela.**
  Otwarcie przechwyconego linku testuje GoTrue, lecz nie dowodzi posiadania
  rzeczywistej skrzynki e-mail. Dla rzeczywistego OWNER najpierw trzeba osobno
  zatwierdzić i skonfigurować SMTP, nadawcę i dokładny dozwolony adres właściciela
  oraz sprawdzić odbiór wiadomości. Nie zmieniaj ręcznie plików `.local/` ani
  fingerprintów manifestu, aby obejść kontrolę konfiguracji.
- Dopóki ten warunek nie jest spełniony, wykonuj wyłącznie próby na fikcyjnych
  kontach. Nie ustawiaj `email_confirmed_at` w SQL, nie włączaj autoconfirm i nie
  kopiuj tokenu z bazy/Mailpit jako zamiennika weryfikacji rzeczywistej skrzynki.

## 2. Tunel i kopia bezpieczeństwa

**LOKALNY KOMPUTER POP!_OS, własne konto:** jeśli tunel jeszcze nie działa:

```sh
ssh -N -L 8443:127.0.0.1:8443 shadowadmin@ADRES_VPS
```

Wpisz własny adres VPS, sprawdź klucz hosta. Oczekiwany wynik: sesja pozostaje
otwarta bez powłoki, a strona działa pod `https://localhost:8443`. `Ctrl+C`
zamyka tylko tunel. Codex nie wykonuje tego połączenia.

**SERWER CONTABO, `shadowadmin`, katalog repozytorium:** poniższe polecenia
zakładają istniejącą konfigurację `.local/contabo-private`. Jeżeli instalacja
ma inną lokalizację, użyj jej rzeczywistej ścieżki zamiast tej przykładowej.
Nie uruchamiaj `staging:prepare`, `npm run demo`, resetów ani `down -v`.

```sh
npm run staging:check -- --dir=.local/contabo-private
npm run staging:ops -- backup --dir=.local/contabo-private
```

Oczekiwany wynik: kontrola konfiguracji i zaszyfrowana kopia bazy/sekretów.
Zachowaj plik kopii, a klucz odzyskiwania przechowuj oddzielnie offline.
Jeśli którykolwiek krok kończy się błędem, przerwij przed nadaniem OWNER.
Nie odtwarzaj kopii przez nadpisanie obecnej bazy.

## 3. Rejestracja i potwierdzenie

**POP!_OS, przeglądarka właściciela:** otwórz `/apply/partner/` na prywatnym
stagingu. Zarejestruj własny adres i unikalne hasło w menedżerze haseł; podaj
prawdziwe dane operatora. ShadowBridge pozostaje marką, nie osobną spółką.
Nie używaj wspólnego konta zespołu ani haseł demonstracyjnych.

Otwórz otrzymaną wiadomość w swojej skrzynce i sprawdź, czy link prowadzi do
`https://localhost:8443/auth/confirm`. Po potwierdzeniu zaloguj się przez
`/member-sign-in/`. Konto nie otrzymuje jeszcze uprawnień zarządczych ani
automatycznego dostępu do ofert. Brak wiadomości oznacza zatrzymanie procedury,
a nie zgodę na ręczne oznaczenie konta jako potwierdzonego.

## 4. Jednorazowe nadanie OWNER

**SERWER CONTABO, `shadowadmin`, katalog repozytorium:** dopiero po potwierdzeniu
rzeczywistej skrzynki i ustaleniu tożsamości osoby, której nadajesz rolę:

```sh
read -r -p 'Potwierdzony e-mail właściciela: ' SB_OWNER_EMAIL
npm run staging:ops -- owner --dir=.local/contabo-private --email="$SB_OWNER_EMAIL" --grant-owner
unset SB_OWNER_EMAIL
```

Narzędzie działa w osobnym kontenerze migratora z uprawnieniem DBA, nigdy w
runtime aplikacji. Wymaga dokładnie jednego potwierdzonego konta Auth i aktywnego,
potwierdzonego konta aplikacji. Zapisuje `owner.bootstrap` w audycie, nie tworzy
hasła i nie wyłącza MFA. Jeżeli obraz nie zawiera narzędzia albo kontrola odmawia,
przerwij; nie zastępuj jej ręcznym SQL. Konto partnera i jego zgłoszenie biznesowe
pozostają osobną sprawą od uprawnienia pracowniczego OWNER.

## 5. MFA i próba dostępu

**POP!_OS, przeglądarka właściciela:** wyloguj się i zaloguj ponownie, otwórz
`/portal/admin/`. Zanim ukończysz MFA, powinien być widoczny ekran
„Management security verification”, bez danych Command Center.
Wybierz „Set up authenticator app”, zapisz czynnik w swojej aplikacji TOTP
i wpisz bieżący sześciocyfrowy kod. Nie zapisuj sekretu ani kodu w zrzucie,
rozmowie, terminalu lub repozytorium.

Po poprawnej weryfikacji powinien pojawić się „Owner Overview”. Sprawdź
wylogowanie, ponowne logowanie oraz ponowne wymaganie MFA. Wrażliwe operacje
właścicielskie wymagają świeżego MFA przez „Reconfirm MFA”. Nie przyznawaj
innej osobie roli OWNER tylko po to, by sprawdzić przycisk. Błąd oznacza
zatrzymanie operacji; odzyskiwanie opisuje [owner-recovery.md](owner-recovery.md).

Basic Auth nie jest docelowym publicznym logowaniem. Późniejsza publiczna
konfiguracja bramy ma używać normalnego formularza ShadowBridge, z zachowaniem
sesji, RBAC/RLS i MFA. Usunięcie ochrony prywatnego stagingu lub publiczne
udostępnienie wymaga osobnej decyzji i nie jest częścią H1.
