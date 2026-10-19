# Lokalne testowanie na Pop!_OS

Potrzebujesz **Node.js 22.12+ z npm** i uruchomionego **Docker Engine z Compose v2**. Sprawdź w terminalu `node --version`, `docker compose version` oraz `docker info`. Jeśli brakuje Dockera, użyj [oficjalnej instrukcji dla Ubuntu](https://docs.docker.com/engine/install/ubuntu/) z bazową wersją Ubuntu swojej instalacji Pop!_OS. Nie uruchamiaj npm przez sudo; prawo do demona Docker daje uprawnienia administracyjne do komputera.

1. Pobierz i rozpakuj ZIP gałęzi `feature/secure-b2b-mvp`. Otwórz terminal w katalogu zawierającym `package.json`.
2. Przy pierwszym uruchomieniu wykonaj:

   ```bash
   npm ci
   npm run demo
   ```

3. Poczekaj na komunikat **MVP gotowy**. Pierwszy start pobiera obrazy kontenerów; potrzebny jest Internet. Otwórz <http://127.0.0.1:8088/member-sign-in/> na tym samym komputerze.
4. W drugim terminalu, w tym samym katalogu, wykonaj `npm run demo:accounts`. Zobaczysz **wygenerowane dla tej instalacji** adresy i hasła Buyer, Supplier, Partner i Owner. Nie ma wspólnego stałego hasła. Zaloguj się wybranym kontem; wygodnie użyć osobnego profilu lub prywatnego okna dla każdej roli.
5. Owner: po zalogowaniu otwórz <http://127.0.0.1:8088/portal/admin/>. W drugim terminalu wykonaj `npm run demo:code` i wpisz aktualny kod MFA. Jest to rzeczywisty lokalny TOTP; ten uproszczony generator kodu służy wyłącznie demonstracji na własnym komputerze, nie produkcyjnemu uwierzytelnianiu.

Demo tworzy wyłącznie fikcyjne konta `@demo.shadowbridge.invalid`. Przeprowadza prawdziwą rejestrację, odbiór e-maila w Mailpit, potwierdzenie adresu, MFA właściciela oraz zatwierdzenie firm przez API zarządcze. Zawiera ofertę Supplier, RFQ Buyer, przydzieloną wyłącznie Buyer anonimową okazję, propozycję Partner, projekt i fikcyjnie uzgodnioną prowizję. Nie pomija uprawnień. Automatyczne zatwierdzenie dotyczy tylko własnych fikcyjnych kont demonstracji; zwykłe nowe zgłoszenia pozostają do ręcznej decyzji.

**Adresy:** aplikacja <http://127.0.0.1:8088/>, testowa skrzynka <http://127.0.0.1:8025/>. Poczta nie trafia do Gmaila. Nową ręczną rejestrację potwierdzisz, otwierając e-mail w Mailpit; potem zaloguj się jako Owner i zatwierdź zgłoszenie w Command Center. Upload dokumentów pozostaje wyłączony. Nie wprowadzaj prawdziwych danych biznesowych.

**Zatrzymanie:** Ctrl+C w terminalu demo; następnie `npm run dev:down` zatrzymuje kontenery, zachowując bazę. Kolejny start to tylko `npm run demo`. Jeśli port 8088 jest zajęty, zatrzymaj wcześniejszy `dev:server`/`demo` przez Ctrl+C. Narzędzie nie zabija obcych procesów ani nie wysyła haseł do innego serwera. Nie odblokowuje zawieszonych i nie zatwierdza ponownie odrzuconych kont.

Losowe sekrety są wyłącznie w ignorowanym katalogu `.local/` (`0700`), w plikach `development.env` i `demo-accounts.json` (`0600`). **Nie wysyłaj ich na GitHub ani w zrzutach ekranu.** Plik kont demo zawiera również sekret lokalnego MFA. Zachowaj `.local/` i wolumen bazy między uruchomieniami; ich usunięcie nie jest procedurą naprawy. Wszystkie porty są dostępne wyłącznie na własnym komputerze. Nie utworzono usług chmurowych i nie zmieniono produkcji.
