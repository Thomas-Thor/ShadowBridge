# H2 — późniejsza aktualizacja istniejącego prywatnego stagingu

Do wykonania przez właściciela, po przeglądzie raportu i zatwierdzeniu aktualizacji.
Codex nie łączył się z Contabo. Nie zmieniaj DNS, `main`, tunelu, domeny ani
bramy reviewer. Nie uruchamiaj `npm run demo`, `staging:prepare`, `down -v`,
resetów bazy ani generowania nowych sekretów dla istniejącej instalacji.

**SERWER CONTABO, `shadowadmin`, katalog istniejącego repozytorium.**
W poleceniach `.local/contabo-private` oznacza dotychczasowy katalog konfiguracji;
jeśli na serwerze ma inną nazwę, użyj tej istniejącej nazwy.

1. Sprawdź gałąź i lokalne zmiany:

   ```sh
   git branch --show-current
   git status --short
   git rev-parse HEAD
   ```

   Oczekiwane: `feature/secure-b2b-mvp` i brak nieznanych zmian. Zapisz SHA jako
   punkt powrotu. Przy różnicach zatrzymaj się; nie stosuj `reset --hard` ani
   `clean`. Znana ręczna poprawka bcrypt jest opisana w
   [instrukcji H1](H1-STAGING-UPDATE.md); nie nadpisuj jej w ciemno.

2. Przed pobraniem kodu sprawdź konfigurację i zrób kopię:

   ```sh
   npm run staging:check -- --dir=.local/contabo-private
   npm run staging:ops -- backup --dir=.local/contabo-private
   ```

   Oczekiwane: kontrola bez błędów oraz zaszyfrowany backup i osobny klucz.
   Zachowaj oba, klucz także poza serwerem. Operacja chwilowo zatrzymuje zapis
   API/Auth, następnie przywraca wcześniej działające usługi. Przy błędzie nie
   przechodź dalej. Sam fakt utworzenia pliku nie dowodzi możliwości odtworzenia:
   przed testami z rzeczywistymi danymi potrzebna jest próba odzyskiwania w
   **nowym, osobnym projekcie**, bez nadpisywania obecnej bazy.

3. Pobierz wyłącznie gałąź rozwojową i porównaj pełne SHA z zatwierdzonym raportem:

   ```sh
   git pull --ff-only origin feature/secure-b2b-mvp
   git rev-parse HEAD
   ```

   Przy konflikcie, innym SHA albo potrzebie merge zatrzymaj się. Pobranie kodu
   nie zastępuje jeszcze działającego obrazu aplikacji.

4. Aktualizuj istniejącą instalację kontrolowanym poleceniem:

   ```sh
   npm run staging:check -- --dir=.local/contabo-private
   npm run staging:ops -- update --dir=.local/contabo-private
   npm run staging:ops -- status --dir=.local/contabo-private
   ```

   Polecenie ponownie robi backup przed budową, zapisuje `previous-images.json`,
   sprawdza checksumy historii i stosuje brakujące migracje. Zestaw H2 obejmuje
   **012** (trwałe szkice rejestracji), **013** (widoczność kont i profili dla
   uprawnionych recenzentów) i **014** (historia decyzji). Nie przepisuje starych
   kont, wniosków ani ról OWNER. Historia 014 zachowuje ostatnią znaną dawną
   decyzję jako oznaczony snapshot; nie odtwarza nieznanych wcześniejszych
   decyzji. Wolumeny i istniejące klucze pozostają te same.
   Nie wykonuj ręcznych zmian historycznych migracji ani SQL potwierdzającego
   e-mail. Błąd oznacza przerwanie dalszych czynności, nie reset.

**POP!_OS, własne konto, istniejący tunel:** otwórz `https://localhost:8443`.
Sprawdź reviewer, logowanie własnego OWNER i MFA. Do próby rejestracji użyj
wyłącznie uzgodnionych kont testowych; nie zapraszaj kontrahentów. Bez właściwej
konfiguracji wysyłki wiadomości potwierdzenia pozostają w prywatnym Mailpit —
nie oznacza to przetestowania zewnętrznej poczty ani własności skrzynki.

**Wycofanie:** nie usuwaj migracji 012–014 ani nowych tabel i nie odtwarzaj kopii na
obecnym wolumenie. Zachowaj backup, klucz, poprzednie obrazy i SHA. Jeśli błąd
wystąpił po migracji, bezpiecznym wariantem jest osobne odtworzenie kopii sprzed
aktualizacji z odpowiadającym jej kodem, sprawdzenie tej kopii i dopiero decyzja
właściciela o przełączeniu prywatnego środowiska. Cofnięcie samego kodu przy
pozostawionej nowej bazie wymaga przeglądu zgodności; nie wykonuj go automatycznie.
`Ctrl+C` nie cofa migracji ani zbudowanych obrazów: najpierw sprawdź `status`.

Ta procedura nie została wykonana na VPS. Lokalne wyniki testów i ich ograniczenia
są zapisane w raporcie danego etapu.
