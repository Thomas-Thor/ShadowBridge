# International R1 — checkpoint i bramka wydania

**Końcowy audyt: READY FOR PREFLIGHT.** Brak odczytu Contabo uniemożliwia
zatwierdzenie bezpośredniego deployu. Znany historyczny staging/oddzielny Caddy
może wymagać wcześniejszego etapu zgodności. Nie uznawać wymaganych profili za
istniejące na podstawie samych lokalnych testów. Obowiązuje etap 0
[jedynej procedury operatora](INTERNATIONAL-R1-DEPLOYMENT.md).


**24.10.2026. Pakiet techniczny: przetestowany lokalnie. Wdrożenie: niewykonane.**

Zamknięto blokady lokalnych obrazów, rollbacku i pełnego odtworzenia stosu.
Przed uruchomieniem na Contabo pozostaje obowiązkowy odczyt zastanej instalacji
(`preflight`) oraz potwierdzenie logowania rzeczywistego OWNER. Nie mamy dostępu SSH;
wyników lokalnych nie przedstawiamy jako weryfikacji domeny produkcyjnej.

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

## Zamknięte blokady lokalne — 24.10

- Zbudowano oficjalne obrazy runtime/migratora poprzedniej wersji i R1.
  Produkcyjny Compose + overlay gatewaya działał na odrębnym Docker daemonie
  z PostgreSQL 17, GoTrue 2.184.0, Node 24 i **prawdziwym n8n 2.44.6**.
- Potwierdzono TLS aplikacja→PostgreSQL oraz aplikacja→Auth przez Caddy;
  oba hosty HTTPS używały zaufanej lokalnej CA, bez wyłączania weryfikacji TLS.
- Migrator wykonał 001–015, następnie 016/017; zachowano wszystkie wcześniejsze
  wiersze. Rzeczywisty rollback niezmiennego obrazu i ponowne R1 zachowały sesje,
  MFA, RFQ oraz dodane już dane VAULT. Stare obrazy zachowano.
- Zaszyfrowane kopie SQL, prywatnej konfiguracji, profilu publicznego/gatewaya
  i trwałych danych Caddy odtworzono do oddzielnego projektu Compose.
  Porównano 70 tabel Auth/biznesowych i ledger (łącznie 71), 13 plików Caddy,
  oryginalne klucze oraz token proxy. Odtworzony stos rzeczywiście działał:
  istniejące sesje, OWNER aal2, VAULT, RFQ i logowanie starym hasłem.
- Dodano `backup-edge` i odczytowy `preflight`; kontrola OWNER opiera się na
  prawdziwej roli, aktywności konta, potwierdzonym e-mailu i MFA, bez nazw osób.
- Obejście braku miejsca dotyczyło wyłącznie izolowanego testu w `/tmp`.
  Nie czyszczono starego środowiska. Kontenery aplikacji wymieniał wyłącznie
  Compose w nowym fikcyjnym projekcie; nie usuwano wolumenów, kont ani backupów.

## Warunki przed wykonaniem aktualizacji na Contabo

1. Operator uruchamia **odczytowy** `preflight` z procedury wdrożenia. Musi
   potwierdzić niezmieniony profil 7f794a2, aktywny fingerprintowany gateway,
   izolowaną sieć n8n, brak publicznych portów danych, istniejące OWNER+MFA,
   historię migracji oraz odpowiedzi obu rzeczywistych domen HTTPS.
   Brak aktywnego profilu, inny SHA lub błąd oznacza STOP, bez regenerowania
   manifestów/sekretów. Obecnej konfiguracji serwera nie znamy z odczytu SSH.
2. OWNER sam potwierdza normalne logowanie i MFA przed oknem oraz po aktualizacji.
   Testowe konto nie dowodzi niczego o faktycznej roli Vincenta.
3. Zatwierdzony pełny commit musi być dostępny na GitHubie; operator sprawdza SHA,
   wolne miejsce i zachowuje klucze/kopie osobno, również poza VPS.
4. Osobne zatwierdzenie okna utrzymaniowego. Bezpośrednie publiczne HTTPS/ACME
   i rzeczywiste dane na Contabo nie były testowane: proxy blokuje CONNECT,
   a ten etap nie łączył się z VPS. Jest to ostatnia kontrola instalacji,
   a nie potrzeba kolejnej przebudowy platformy.

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

Po zaliczeniu kontroli Contabo: aktualna witryna International i prawdziwa kolejka kontaktowa;
logowanie **dotychczasowych potwierdzonych kont**, MFA, bieżące role/panele,
oferty/RFQ i przypisywane anonimowe okazje; VAULT tylko OWNER + MFA, bez importu
i automatycznych integracji. Rejestracja/reset e-mail wyłączone, materiały ofert
nieaktywne, C.A.R.T.E.L. informacyjny. To nie jest uruchomienie pozyskiwania nowych
użytkowników lub automatycznej obsługi transakcji.

Wyniki: [R1-TESTS](INTERNATIONAL-R1-TESTS.md).
Procedura do przeglądu: [R1-DEPLOYMENT](INTERNATIONAL-R1-DEPLOYMENT.md).
Nie uruchamiać aktualizacji przed zaliczeniem preflight i osobnym zatwierdzeniem.
