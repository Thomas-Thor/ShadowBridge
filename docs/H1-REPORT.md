# H1 — nawigacja i dostęp prywatny

Baza: `478568ec1821dfc4a643bce72402f641c9a546ad`. Wyłącznie gałąź
`feature/secure-b2b-mvp`; bez połączeń z Contabo i bez wdrożenia.

## H1-A

Dodano Member Access z oryginalną ikoną złotej bramy i osobnym arkuszem CSS.
Dotychczasowe menu, Let's talk, sekcje, formularze i symbol C.A.R.T.E.L. zachowano.
Na wąskim telefonie pozostaje widoczna ikona z dostępną nazwą Member Access.

**2/2 testy Chromium PASS**, szerokości 1440/1200/1024/1001/1000/768/390/320:
brak overflow, cel 44 px, klawiatura/Enter, menu mobilne/Escape, odnośniki do
Member Sign In, Legal i trzech Apply oraz istniejące kotwice. Axe w nagłówku:
brak naruszeń WCAG A/AA. To testy nawigacji statycznej, nie uwierzytelniania.
Nowe CSS/SVG dodano też do jawnej listy paczki statycznej; zbudowanie nowej
paczki i obecność obu plików sprawdzono bez nadpisywania wcześniejszych wyników.

## H1-B

Entry point Caddy generuje teraz bcrypt, a nowy szablon deklaruje `basic_auth
bcrypt`. **2/2 rzeczywiste testy HTTPS/Caddy PASS**: nowy szablon oraz stary
domyślny `basic_auth`, poprawne hasło 200, brak/błędne 401, hasło bez newline,
sprawdzony certyfikat, noindex/no-store. Nie regenerowano istniejącego hasła.

Na odrębnym projekcie z fikcyjnym kontem wykonano **5/5 testów rzeczywistej
integracji PASS**: PostgreSQL 17, GoTrue, API Node i Caddy. Migracje 001–011
zostały rzeczywiście zastosowane; OWNER przed potwierdzeniem e-maila był
odrzucony. Po potwierdzeniu w Mailpit narzędzie bootstrap nadało rolę z audytem.
Zwykły formularz zalogował konto; UI rejestracji authenticatora i prawdziwy TOTP
odblokowały Owner Overview. Przed MFA API zarządu zwracało 403. Potwierdzono
Secure/HttpOnly, odmowy CSRF/braku tokenu/obcego Origin, sesję, 1440/390/320 px
i wylogowanie w dwóch kartach usuwające dashboard i nawigację.

Testy ujawniły i naprawiono dwa dodatkowe problemy:

- Skrypt bootstrap na hoście z umask 077 nie był czytelny po zmianie UID na
  postgres. Wrapper kopiuje kod wewnątrz kontenera z właściwą własnością;
  istniejące pliki, hasła i bazy nie są zmieniane. Nieudany nowy fixture
  zatrzymano i zachowano; poprawkę sprawdzono na kolejnej nowej bazie.
- Automatyczny proxy klienta Docker kierował ruch prywatny poza sieć projektu.
  Compose jawnie wyłącza proxy HTTP/HTTPS/ALL dla API/Auth/bramy i określa
  prywatne NO_PROXY. Po usunięciu override testowego sprawdzono ponownie
  właściwy Compose: TLS/brama/API/GoTrue PASS, konto i MFA zachowane.

**2/2 testy konfiguracji pakietu PASS**, w tym brak ekspozycji portów i brak
proxy w runtime. Początkowy błędny parametr `compose run --no-build` poprawiono
wyłącznie w runnerze; nie był błędem aplikacji.

Usługi testowe działały z buforowanego Node 24 i kopii źródeł/zależności zgodnych
z lockfile. Nie budowano obrazów, nie uruchamiano demo ani nie wykonywano pełnej
regresji G3. Przechwycona poczta testuje mechanizm GoTrue, nie dostarczalność SMTP
i nie posiadanie rzeczywistej skrzynki. Nie wysłano zewnętrznych wiadomości.
Testowe kontenery/wolumeny zachowano zatrzymane. Oryginalny projekt pozostał
uruchomiony; nie wykonywano na nim operacji.

[Pierwszy rzeczywisty OWNER](H1-OWNER-ACCESS.md) wymaga zatwierdzenia SMTP
i rzeczywistego potwierdzenia skrzynki. [Późniejsza aktualizacja stagingu](H1-STAGING-UPDATE.md)
zachowuje istniejącą konfigurację i bramę; procedury nie wykonywano na Contabo.
