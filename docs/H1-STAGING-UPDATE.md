# H1 — późniejsza aktualizacja prywatnego stagingu

Do wykonania przez właściciela; Codex nie łączył się z VPS. Nie jest to
instrukcja publikacji. Brama reviewer, tunel i obecne HTTPS pozostają włączone.

**SERWER CONTABO, konto `shadowadmin`, katalog istniejącego repozytorium.**
Polecenia wymagają dotychczas działających Node/npm i Docker Compose.
W każdym poleceniu zastąp `.local/contabo-private` rzeczywistym katalogiem
istniejącej konfiguracji. Nie twórz nowego zestawu sekretów dla starej bazy.

1. Sprawdź gałąź i zmiany:

   ```sh
   git branch --show-current
   git status --short
   ```

   Oczekiwane: `feature/secure-b2b-mvp`. Jeżeli są nieznane lokalne zmiany,
   przerwij przed pobraniem aktualizacji. Nie używaj `reset --hard` ani `clean`.
   Jeżeli jedyną zmianą jest zgłoszona ręczna poprawka bcrypt, zachowaj ją:

   ```sh
   git diff -- deploy/staging/caddy-entrypoint.sh
   git stash push -m 'Contabo: zachowana ręczna poprawka bcrypt przed H1' -- deploy/staging/caddy-entrypoint.sh
   ```

   Nie usuwaj tego stash i nie nakładaj go automatycznie na nowy kod. Jeśli diff
   zawiera coś poza znaną poprawką algorytmu, zatrzymaj aktualizację do przeglądu.

2. Sprawdź konfigurację i wykonaj kopię **przed zmianą kodu**:

   ```sh
   npm run staging:check -- --dir=.local/contabo-private
   npm run staging:ops -- backup --dir=.local/contabo-private
   ```

   Oczekiwane: kontrola bez błędów oraz pliki zaszyfrowanej kopii i klucza.
   Backup chwilowo zatrzymuje zapis API/Auth i przywraca wcześniej działające
   usługi. Przechowuj klucz oddzielnie offline. Jeśli kontrola/backup odmawia,
   zatrzymaj się; nie obchodź fingerprintów i nie edytuj plików `.local/`.

3. Pobierz wyłącznie gałąź rozwojową:

   ```sh
   git pull --ff-only origin feature/secure-b2b-mvp
   git log -1 --format='%H'
   ```

   SHA musi odpowiadać końcowemu raportowi H1. Jeśli jest inny, pojawia się
   konflikt albo wymagany jest merge, przerwij. Działające obrazy pozostają
   dotychczasowymi obrazami. Nie zmieniaj `main` ani konfiguracji hostingu.

4. Wykonaj kontrolowaną aktualizację:

   ```sh
   npm run staging:ops -- update --dir=.local/contabo-private
   npm run staging:ops -- status --dir=.local/contabo-private
   ```

   Aktualizacja ponownie wykonuje backup przed budową, zachowuje wolumeny,
   klucze sesji/Auth i MFA oraz sprawdza historię migracji. H1 nie dodaje SQL.
   Nie zastępuj tego samym `docker compose restart`: zmiana montowania skryptu
   PostgreSQL wymaga odtworzenia konfiguracji kontenera przez `up`, z zachowaniem
   tego samego wolumenu. Istniejąca baza pomija ponowny bootstrap.

   Błąd oznacza zatrzymanie przed dalszymi krokami. Zachowaj stare obrazy,
   `previous-images.json`, backup i jego klucz. Nie przywracaj bazy przez
   nadpisanie; odzyskiwanie najpierw sprawdza się w osobnym projekcie. Samo H1
   nie wymaga resetu kont ani zmiany haseł. `Ctrl+C` nie cofa wykonanych operacji;
   po przerwaniu najpierw sprawdź `status`, bez usuwania kontenerów/wolumenów.

**POP!_OS, własne konto i istniejący tunel:** otwórz `https://localhost:8443`.
Sprawdź reviewer, Member Access, Let's talk, Legal, trzy Apply i Member Sign In.
Zaloguj własne konto i potwierdź MFA, potem sprawdź wylogowanie w dwóch kartach.
Nie fotografuj hasła, sekretu TOTP ani formularza z danymi logowania.
Pierwsze rzeczywiste konto opisuje [H1-OWNER-ACCESS.md](H1-OWNER-ACCESS.md).

Nowy bcrypt entrypoint współpracuje również ze starym wygenerowanym Caddyfile
z domyślnym `basic_auth`. Nie trzeba regenerować konfiguracji ani hasła reviewer.
Publiczny wariant bez Basic Auth wymaga osobnego etapu; nie usuwaj obecnej bramy.
