# International R1 — checkpoint i bramka wydania

**23.10.2026. Gotowość do zatwierdzenia wdrożenia: NIE. Nie wykonano wdrożenia.**

## Co zintegrowano

Gałąź `release/shadowbridge-international-r1` pochodzi z OWNER VAULT V2
`188cdafd8a91f215fd2c10aa4f893f482cb54564`, zawiera V1 `6d200ee` oraz merge
gatewaya `9a64cc0a0e4831e786e19bc1101a4126d66756ff`. Wspólna baza:
`7f794a298713d820af033ba2174cd60bfaa81e4b`. Przejrzano różnice przed połączeniem.
Jedyny wspólny zmieniany plik to `scripts/production-ops.mjs`; zmiany dotyczyły
odrębnych fragmentów i połączono je bez konfliktu tekstowego. Zachowano oba:
overlay gatewaya i odzyskiwanie ról VAULT. Nie włączono Market, Scouta ani importerów.

Poza zatwierdzonym zakresem V1/V2 nie zmieniono runtime aplikacji, publicznego designu, auth, MFA, RBAC, RLS,
migracji 001–017, Caddyfile produkcyjnego, Compose produkcyjnego ani portów.
Istniejące 016/017 są częścią gałęzi, lecz nie zostały zastosowane na Contabo.

## Kontrola funkcji

| Obszar | Faktyczny stan R1 |
| --- | --- |
| Logowanie i sesje | Rzeczywisty GoTrue + BFF; istniejące konta logują się bez SMTP |
| MFA i siedem ról | Obowiązkowe MFA personelu, API/SQL sprawdzają role; manager nie może zmienić OWNER |
| Command Center i VAULT V1/V2 | Działające listy, decyzje i KPI; VAULT wyłącznie rzeczywisty OWNER + MFA |
| Buyer/Supplier/Partner | Własne RFQ/oferty/projekty; izolacja drugiego Buyera; tylko przypisane anonimowe okazje |
| Decyzje operacyjne | Procurement zatwierdza ofertę po kwalifikacji; Sales przegląda RFQ i udostępnia okazję; Operations przypisuje projekt |
| Kategorie i waluty | Istniejące 8 kategorii/24 podkategorie; wspólny katalog; test zapisu PLN bez przeliczania |
| Konta i aplikacje | Istniejące oddzielne listy i uprawnienia; rejestracja produkcyjna świadomie wyłączona bez SMTP |
| Kontakt | Prawdziwy zapis do prywatnej kolejki, CSRF i kontrolowany odczyt; bez wysyłania wiadomości |
| Publiczne strony | Istniejąca strona, Member Sign In, trzy Apply, Legal i C.A.R.T.E.L.; sprawdzone lokalnie |
| C.A.R.T.E.L. | Wyłącznie informacyjna strona invitation-only; nie jest gotowym prywatnym portalem |
| Zdjęcia/dokumenty | Specyfikacja i miejsca w UI; brak aktywnego bezpiecznego uploadu |

Faktyczne przypisanie roli konta właściciela na Contabo pozostaje **nieustalone**.
Testy nie identyfikują osoby przez nazwę „Vincent”. Nie nadawano ani nie zmieniano
żadnych rzeczywistych kont, haseł, ról lub MFA.

## Poprawki związane z wydaniem

1. Dotychczasowy pełny instalator wymaga starej gałęzi i odtwarza również Auth oraz
   gateway. Nie nadaje się do bezpośredniej aktualizacji R1 z aktywnym n8n.
   Dodano osobny **plan aktualizacji tylko aplikacji**, z oryginalnym profilem
   `7f794a2` jako niezmienioną kotwicą konfiguracji. Nie osłabiono starego guardu.
2. Plan zapisuje niezmienne ID nowego/poprzedniego obrazu, źródłowy SHA i odciski
   profili. Sprawdza rzeczywisty merge Compose i dopuszcza wyłącznie zmianę
   `app.image` i `app.environment.RELEASE_SHA`. Gateway/DB/Auth/sieci/wolumeny
   muszą być identyczne. Generuje ręczne skrypty apply/rollback, bez uruchamiania ich.
3. Dodano etykietę OCI revision do Dockerfile oraz wymaganie zgodności obrazu
   z wydaniem. Nowy weryfikator rozróżnia SHA aplikacji od starej kotwicy profilu;
   nie należy używać starego `production:verify`, który oczekuje SHA kotwicy.
4. Rozszerzono odciski ochronne z części Auth i sb/VAULT na **całe Auth, portal,
   sb i VAULT**. Utrata anonimowych okazji lub innych danych Auth nie może zostać
   pominięta przez kontrolę zachowania danych.
5. Osobny zaszyfrowany backup konfiguracji obejmuje także publiczny profil,
   selector i fingerprintowany gateway; stary backup instalacji obejmuje DB,
   prywatne klucze i konfigurację bazową. Są to uzupełniające się archiwa.

## BLOCKER — przed zatwierdzeniem wdrożenia

- **Pełny test produkcyjnych obrazów i Compose** z weryfikowanym TLS DB/Auth,
  aktywnym overlayem gatewaya oraz rzeczywistym rollbackiem niezmiennych obrazów.
  Potwierdzono rollback kodu na rzeczywistym backendzie, nie obrazów Docker.
  Po zachowaniu wszystkich zasobów pozostało około 143 MB; nie rozpoczęto budowy,
  która groziłaby zapełnieniem dysku. Niczego nie usunięto, aby zwolnić miejsce.
- **Odtworzenie całej instalacji** z obu archiwów oraz zabezpieczenie trwałych
  danych Caddy/TLS w niezależnym celu. Przywrócono komplet danych SQL 017 i
  osobno sprawdzono archiwum konfiguracji; nie są to jeszcze pełne ćwiczenia
  odtworzenia całego produkcyjnego stosu i certyfikatów.
- **Rzeczywista konfiguracja serwera i n8n:** potwierdzić istniejący aktywny,
  fingerprintowany gateway, nazwy projektu/wolumenów i oba publiczne HTTPS.
  Proxy środowiska blokuje CONNECT do obu domen kodem 403 także poza sandboxem.
  To nie dowodzi błędu Contabo. Aktualny test Caddy używał fikcyjnego upstreamu;
  nie deklarujemy testu prawdziwego produkcyjnego n8n.
- Uprawniony operator/właściciel musi potwierdzić **istniejący OWNER + MFA**
  bez zmiany konta; nie zakładamy, że wskazana osoba ma tę rolę. Potem potrzebna
  jest osobna zgoda na okno utrzymaniowe i zastosowanie zatwierdzonego R1.

## GO-LIVE — przed zapraszaniem nowych klientów

- Zatwierdzony SMTP i realne próby dostarczenia: potwierdzanie adresów, resend,
  odzyskiwanie hasła, brak automatycznego dostępu po rejestracji. Bez SMTP te
  ścieżki pozostają zamknięte i nie wolno reklamować działającej rejestracji.
- Ustalona osoba obsługująca kolejkę kontaktową, aplikacje, kwalifikację firm,
  decyzje i incydenty; sama obecność firm w rejestrze nie upoważnia reprezentanta.
- Polityka prywatności/retencji, podstawy przetwarzania danych CRM, umowy handlowe,
  weryfikacja informacji operatora i lokalnych wymogów. Adres rejestrowy nadal
  wymaga osobnego zatwierdzenia publikacji; bez dopisywania VAT/MVA.
- Klucze i zaszyfrowane kopie poza VPS, harmonogram i retencja, odpowiedzialność
  za recovery oraz przećwiczony przypadek utraty authenticatora. Nie resetować MFA
  przy aktualizacji; narzędzie odzyskania samego hasła jest procedurą awaryjną.
- Bezpieczne materiały ofert wymagają private storage, kwarantanny, skanowania,
  redakcji tożsamości i zatwierdzania odbiorców. Do tego czasu brak uploadu oraz
  alternatywny, zatwierdzony proces obsługi dokumentów poza tą funkcją.

## LATER

Prywatny portal C.A.R.T.E.L., dalszy Sentinel, automatyczne źródła/AI/Scout,
automatyzacja CRM, zaawansowana analityka i edytor strony. Nie blokują wydania
ograniczonego do obecnych funkcji i nie zostają włączone przez R1.

## Najmniejszy bezpieczny pierwszy zakres

Po zamknięciu BLOCKER: aktualna witryna International i prawdziwa kolejka kontaktowa;
logowanie **dotychczasowych potwierdzonych kont**, MFA, bieżące role/panele,
oferty/RFQ i przypisywane anonimowe okazje; VAULT tylko OWNER + MFA, bez importu
i automatycznych integracji. Rejestracja/reset e-mail wyłączone, materiały ofert
nieaktywne, C.A.R.T.E.L. informacyjny. To nie jest uruchomienie pozyskiwania nowych
użytkowników lub automatycznej obsługi transakcji.

Wyniki: [R1-TESTS](INTERNATIONAL-R1-TESTS.md).
Procedura do przeglądu: [R1-DEPLOYMENT](INTERNATIONAL-R1-DEPLOYMENT.md).
Nie uruchamiać jej przed zamknięciem blokad i osobnym zatwierdzeniem.
