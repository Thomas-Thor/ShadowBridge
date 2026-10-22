# ShadowBridge — przejście z prywatnej instalacji na główną domenę

**Aktualizacja 22.10.2026:** obowiązuje teraz
[procedura bez poczty](CONTABO-NO-MAIL.md). Poniższy opis Gmaila i tworzenia
oddzielnego projektu odzyskiwania jest historyczny; nie jest bieżącą procedurą.

**Stan 21.10.2026: pakiet sprawdzony lokalnie, niewdrożony na Contabo.**
Codex nie ma w tej sesji adresu dostępowego/klucza SSH do VPS. Proxy środowiska
odrzuca także odczyt `https://shadow-bridge.eu` (CONNECT 403), a lokalny resolver
nie rozwiązuje domeny. Nie potwierdzamy działania nowej wersji pod publicznym
adresem. Poniższa jedna procedura jest przeznaczona dla istniejącej instalacji
Docker, nie dla nowej, pustej bazy ani lokalnego `npm run demo`.

## Co przygotowano

Osobny profil `deploy/production/` używa **tego samego projektu i wolumenu bazy**
co dotychczasowa instalacja. Nie zmienia pierwotnej konfiguracji `.local/`:
publiczne pliki powstają w jej podkatalogu `production/`. Zachowuje hasła ról,
JWT, klucz szyfrowania sesji, czynniki MFA i wewnętrzne TLS. Caddy udostępnia
wyłącznie porty 80/443; PostgreSQL, GoTrue, Mailpit i port aplikacji nie mają
publicznych portów. Auth komunikuje się z zewnętrznym SMTP, a aplikacja z Auth
przez dotychczasową wewnętrzną bramę HTTPS.

Jedyna domena aplikacji: **https://shadow-bridge.eu**. Brak tunelu i Basic Auth
dla użytkowników. Command Center korzysta z normalnego konta i MFA. Ciasteczko
z `localhost` nie przejdzie na domenę; trzeba ponownie się zalogować, bez zmiany
hasła lub ponownej konfiguracji MFA. Nie tworzy się kont demonstracyjnych ani
nowego OWNER. Jeżeli istniejący OWNER wymaga odzyskania dostępu, nie resetuj go
tym instalatorem.

Serwowane są istniejące strony główne, formularze Buyer/Supplier/Partner,
Member Sign In, Legal, `/cartel/` i autoryzowane panele `/portal/`. Zgłoszenia
kontaktu trafiają do bazy; rejestracja wymaga potwierdzenia e-maila, a dostęp do
prywatnych danych nadal wymaga decyzji administratora i odpowiednich uprawnień.
Sentinel ma obecnie fundament bazy H3-A; nie ma jeszcze panelu H3-D lub automatu
H3-B/H3-C. Nie uruchamia się niezaimplementowanych funkcji ani uploadu plików.
Zachowano dotychczasową politykę `noindex`; nie jest to aktualizacja SEO.

## Jedno uruchomienie przez właściciela

**SERWER CONTABO, konto `shadowadmin`, istniejący katalog repozytorium.**
Konto powinno już mieć dostęp do Dockera, Node.js i npm, tak jak przy działającym
prywatnym stagingu. Nie twórz nowego repozytorium ani nowej konfiguracji bazy.

```sh
git pull --ff-only origin feature/secure-b2b-mvp
npm run production:deploy
```

Wymagana gałąź: `feature/secure-b2b-mvp`, bez niezapisanych zmian. Jeżeli Git
zgłosi konflikt lub niezapisany plik, zatrzymaj się — nie używaj `reset --hard`,
`clean` ani usuwania `.local/`. Instalator automatycznie wybiera jedną działającą
instalację. Jeśli nie jest jednoznaczna, można wskazać jej **istniejący** katalog:
`npm run production:deploy -- --dir=.local/contabo-private` (użyj rzeczywistej
nazwy z serwera).

Instalator zapyta o publiczny IPv4 przypisany do tego VPS i **hasło aplikacji
Gmail** dla `shadowbridge.trade@gmail.com`. Hasło wpisuje się w ukrytym pytaniu;
nie trafia do argumentów procesu, GitHuba lub wydruku. Gmail musi mieć włączoną
weryfikację dwuetapową i możliwość tworzenia haseł aplikacji. To nie jest zwykłe
hasło konta Google. Połączenie SMTP używa TLS; kontrola logowania nie wysyła
wiadomości. Poczta transakcyjna ma limit 30 wiadomości/h w GoTrue oraz ograniczenie
częstotliwości; dodatkowo obowiązują limity i zasady konta Gmail.

Narzędzie wykonuje kolejno:

1. Sprawdzenie konfiguracji, gałęzi i zajętych portów. Nie zatrzymuje cudzych
   usług i nie przejmuje istniejącego portu 80/443.
2. Zachowanie identyfikatorów poprzednich obrazów i zaszyfrowanej konfiguracji
   publicznej. Kontrolowane wstrzymanie zapisów aplikacji/Auth na czas operacji.
3. Zaszyfrowany backup PostgreSQL i pierwotnych kluczy/config, a następnie
   **rzeczywisty pg_restore do nowego, oddzielnego projektu** i porównanie danych.
   Baza źródłowa nie jest celem odtwarzania. Kopia, osobny klucz i wolumen
   odzyskiwania pozostają zachowane.
4. Budowę aplikacji i migratora. Dopiero po udanym backupie/odtworzeniu/budowie
   przechodzi do kontroli DNS. Stara publiczna strona może działać do tej chwili.
5. Kontrolę historii migracji, zastosowanie wyłącznie brakujących 001–015,
   kontrolę zachowania istniejących danych i uruchomienie profilu publicznego.
6. Sprawdzenie wewnętrznego Auth, publicznego HTTPS, backendu, stron, ochrony
   paneli i identyfikatora wydania. Stara statyczna strona nie zaliczy tej kontroli.

Narzędzie nie kupuje usług, nie zmienia `main`, DNS, serwerów nazw, konfiguracji
Porkbun lub GitHub Pages. Nie uruchamia demo, nie nadaje uprawnień i nie wysyła
testowych wiadomości do właściciela lub kontrahentów.

Uwzględniono nowszy commit `7bf50ce` i istniejący publiczny Caddy opisany w
`/opt/shadowbridge-public/compose.yaml`. Jeżeli zajmuje porty domeny, instalator
rozpoznaje go po etykietach Compose, ścieżce i obrazie Caddy. Zatrzymuje go dopiero
po backupie, próbie odtworzenia, budowie i migracji; nie usuwa jego kontenera,
plików, certyfikatów lub wolumenów. Każda inna usługa blokuje operację. Aktualną
procedurą tego pakietu jest `production:deploy`; wcześniejszy skrypt
`publish-contabo.sh` pozostaje zachowany w repozytorium.

## Moment przełączenia DNS i HTTPS

Jeżeli DNS nie wskazuje VPS, instalator zatrzyma się na pytaniu i poda konkretny
IPv4. W **Porkbun → zarządzanie domeną → DNS** zastąp dotychczasowy rekord dla
`@` rekordem **A → IPv4 tego Contabo**. Usuń sprzeczny CNAME/ALIAS dla `@` i stare
AAAA dla domeny głównej. Nie zmieniaj MX, TXT, serwerów nazw ani innych domen.
Procedura sprawdza zgodność wszystkich odpowiedzi A, brak starego AAAA i CNAME;
nie przechodzi dalej na podstawie samej deklaracji. Po propagacji naciśnij Enter.

Contabo i firewall systemu muszą przepuszczać TCP **80 i 443**. Zachowaj obecny
dostęp SSH. Instalator nie wyłącza firewalla i nie otwiera portów bazy. Jeżeli
działa dodatkowy firewall w panelu Contabo, właściciel musi dopuścić te dwa porty.
Caddy uzyskuje i odnawia certyfikat ACME bez dodatkowej subdomeny i bez płatnej
usługi. Publicznego wydania certyfikatu nie da się potwierdzić w lokalnym teście.

Prawidłowe zakończenie drukuje **ZWERYFIKOWANO**, adres i pełny SHA. Następnie
otwórz `https://shadow-bridge.eu/member-sign-in/`, zaloguj własnego OWNER i użyj
MFA. Sprawdź też kontrolowane konto Buyer/Supplier/Partner oraz dostarczenie
potwierdzenia/resetu na własną skrzynkę. Instalator nie zna prywatnych haseł
użytkowników i nie oznacza tych czynności jako wykonanych.

Ponowna sama kontrola publiczna: `npm run production:verify`.

## Przerwanie i powrót

Przy błędzie przed uruchomieniem profilu publicznego narzędzie próbuje wznowić
poprzednią prywatną aplikację/Auth. Po rozpoczęciu przełączenia nie przywraca
automatycznie starej bazy: mogły już pojawić się nowe dane. Zachowuje checkpoint
w `.local/<instalacja>/backups/public-.../` i podaje bezpieczny błąd.

Wycofanie do poprzedniego obrazu i prywatnego dostępu:

```sh
npm run production:ops -- rollback --dir=.local/contabo-private --checkpoint=public-NAZWA-ZAPISANEGO-CHECKPOINTU
```

Użyj rzeczywistych nazw z komunikatu. Ta operacja **wyłącza obsługę publicznej
domeny**, przywracając prywatny tryb diagnostyczny; nie cofa danych i nie zmienia
DNS. Nie obiecujemy automatycznego powrotu starej strony z GitHub Pages.
Jeżeli zachowano osobny dawny publiczny Caddy, jego ewentualny ponowny start
wymaga sprawdzenia pierwotnej konfiguracji i sieci — nie uruchamiamy go w ciemno.
Odtwarzanie bazy pozostaje możliwe wyłącznie do nowego projektu, po ocenie stanu
i decyzji właściciela. Backup i klucz trzeba przechować również poza VPS,
oddzielnie od siebie. Kopia na tym samym serwerze nie chroni przed jego utratą.

Zaszyfrowany dodatek konfiguracji publicznej ma własny klucz; kontrolowane
odzyskanie kopii do **nowego katalogu**, bez zmiany działającej instalacji:
`npm run production:ops -- recover-config --dir=.local/contabo-private --checkpoint=public-NAZWA-ZAPISANEGO-CHECKPOINTU`.

`Ctrl+C` nie jest cofnięciem migracji. Jeżeli proces został przerwany, zachowaj
wszystkie pliki i sprawdź procesy przed usunięciem pozostawionej blokady operacji.
Nie uruchamiaj równolegle deploy/rollback. Uszkodzony lub częściowy katalog
`production/` oznacza przerwanie do wyjaśnienia, nie zgodę na kasowanie `.local/`.
Profil jest celowo przypisany do jednego wydania SHA: ponowienie tego samego
wydania jest możliwe, aktualizacja do przyszłego SHA wymaga osobnej procedury.

## Wyniki rzeczywistych prób lokalnych

**10/10 grup PASS**, bez mockowania API/SQL/Auth. Zbudowano oba obrazy Docker.
PostgreSQL 17, GoTrue, Node i Caddy działały w nowym, izolowanym projekcie.
Potwierdzono rejestrację, e-maile GoTrue w Mailpit, MFA OWNER i siedem ról,
ofertę/kwalifikację/akceptację, RFQ, anonimową okazję przypisaną kupującemu,
projekt Partner, izolację danych, zapis kolejki kontaktowej, CSRF i wylogowanie,
reset hasła, restart i zachowanie sesji oraz rzeczywiste odszyfrowanie/pg_restore
kopii do nowej bazy z zgodnymi fingerprintami i odtworzoną rolą Sentinel.
Przeglądarkowo sprawdzono Buyer/Supplier/Partner/OWNER przy 1440, 390 i 320 px.
Dodatkowa próba wycofania rzeczywiście uruchomiła zapisane obrazy, przywróciła
prywatną bramę z Basic Auth i potwierdziła zgodność danych oraz działającą
dotychczasową sesję OWNER z MFA. Pierwszą próbę tego harnessu poprawiono:
żądanie miało właściwy SNI, lecz błędny nagłówek Host. Nie była to usterka produktu.

Testowy hostname prowadził wyłącznie na loopback z certyfikatem testowego CA.
SMTP GoTrue skierowano wyłącznie do prywatnego Mailpit; nie był to test Gmaila.
Kontenery testowe i odzyskiwania zatrzymano, wolumeny i kopie zachowano.
Pierwotnej instalacji właściciela nie zmieniano.

**NIEPRZETESTOWANE zdalnie:** dostęp do Contabo, DNS publiczny, publiczny certyfikat
ACME, rzeczywiste dostarczenie przez Gmail i logowanie istniejącego OWNER na
domenie. Nie uruchamiano pełnego polecenia `production:deploy` przeciw prawdziwej
domenie: lokalnie sprawdzono jego komponenty, migrator, odtworzenie i publiczną
kontrolę HTTPS. To ograniczenie wyniku, nie potwierdzenie publikacji.
Rozpoznawanie istniejącego osobnego publicznego Caddy ma testy ochronne;
przejęcie jego portów na rzeczywistym VPS nie zostało wykonane. Port 465/implicit
TLS potwierdzono w źródłach GoTrue v2.184.0 i jego przypiętej biblioteki Gomail;
nie zastępuje to sprawdzenia dostarczenia wiadomości z docelowego kontenera.

Zanonimizowany [wynik integracji](CONTABO-PUBLIC-RESULTS.json).
