# Poczta i onboarding — audyt oraz testy, 26.10.2026

**BLOCKED FOR PRODUCTION ACTIVATION. LOCAL CAPTURED-MAIL REGRESSION PASS.**

Zakres to najnowszy komentarz OWNER: audyt i etap testowy bez wdrażania. Zapis MCP
pozostaje wstrzymany; nie jest zależnością poczty. Nie aktywowano rejestracji,
SMTP, n8n, importów CRM, Umami ani płatnych usług. Nie zmieniono logiki aplikacji,
konfiguracji produkcyjnej, migracji, OWNER/MFA, sekretów ani checkpointów OAuth.

## Potwierdzone i niepotwierdzone

| Obszar | Stan / dowód |
| --- | --- |
| Stan Contabo | Przekazany przez OWNER audyt potwierdza działającą zaakceptowaną aplikację 80f4a0d, PostgreSQL/GoTrue i HTTPS. To wynik tamtego odczytu, nie nowa sesja SSH Codexa. |
| Rejestracja i weryfikacja | Istniejące API `/api/auth/register`, trwałe zgłoszenie PostgreSQL i `/auth/confirm`; e-mail obowiązkowy, następnie ręczna decyzja. |
| Reset hasła | `/api/auth/recover` → `/auth/recover` → `/api/auth/password`; sesja recovery nie daje zwykłego dostępu. |
| Profil no-mail | `server/app.mjs`, `server/config.mjs`, `scripts/production-config.mjs` świadomie blokują e-mail/rejestrację/reset. Nie należy tego omijać przez ręczne usuwanie walidacji. |
| SMTP Gmail | Istnieje historyczny generator profilu Gmail 465 i test uwierzytelnienia; brak dowodu aktywnej autoryzacji SMTP i dostarczenia na Contabo. Odzyskanie logowania do Gmaila nie potwierdza hasła aplikacji. |
| Sieć GoTrue | Produkcyjny Compose i przekazany odczyt wskazują wyłącznie sieć wewnętrzną. Bez kontrolowanej drogi wyjściowej nie zadziała bezpośredni Gmail SMTP. Nie wystawiać portu Auth ani PostgreSQL. |
| DNS SPF/MX/DMARC | Odczyty z Codexa blokowane: DNS ECONNREFUSED, HTTPS DNS 403. Brak dowodu nie oznacza braku rekordów. |
| DKIM i zgodność nadawcy | Nie zgadywano selektora. Formalny nadawca jest w gmail.com; DNS domeny strony nie dowodzi zgodności wiadomości Gmail. Wymagane nagłówki rzeczywiście dostarczonej wiadomości. |
| Poczta firmowa | Gmail jest istniejącym kontaktem formalnym, nie skonfigurowano nowej skrzynki w shadow-bridge.eu. Korespondencja handlowa to odrębny proces; nie uruchomiono outreach. |
| Dostarczalność / limity konta | NIEPRZETESTOWANE: prawdziwa skrzynka, spam, aktualna polityka i limit konta Google. Historyczny profil ogranicza wysyłkę do 30/h i 60 s na adres; to konfiguracja aplikacji, nie saldo/limit dostawcy. |

## Nowe rzeczywiste testy

`tests/mail-onboarding-lab.mjs --isolated-lab` uruchomił **nową pustą** bazę w
odrębnym lokalnym kontenerze PostgreSQL, GoTrue v2.184.0 i Mailpit. Zastosowano
001–021 tylko tam. Użyto istniejącego obrazu aplikacji 80f4a0d, bez budowania i
pobierania nowych obrazów. Obraz Mailpit skopiowano z istniejącej lokalnej pamięci.
Kontenery nie miały publikowanych portów ani dostępu do sieci zewnętrznej;
komunikowały się przez wspólną przestrzeń loopback (`network=none`).

**7/7 grup PASS**, bez mocków i bez e-maili zewnętrznych:

1. Buyer/Supplier/Partner: zapis zgłoszenia, wiadomość w Mailpit, odmowa logowania
   przed potwierdzeniem, potwierdzenie i logowanie, zachowanie roli i wniosku;
   brak automatycznego przyznawania dostępu.
2. Jednorazowość linku potwierdzenia; odmowa błędnego i wygasłego tokenu.
3. Reset: rzeczywista wiadomość GoTrue, sesja ograniczona do recovery, CSRF,
   nowy zapis hasła, odmowa starego hasła i unieważnienie wcześniejszych sesji;
   role firmy niezmienione.
4. Wygaśnięcie linku resetu, ogólna odpowiedź dla nieistniejącego konta, odmowy
   obcego Origin i braku CSRF.
5. Rzeczywiste logowanie fikcyjnego OWNER i TOTP; zarząd odmawia przed MFA.
   Publiczny reset nie zmienia hasła OWNER, jego ról ani czynników MFA.
6. Ręczna akceptacja trzech zgłoszeń przez testowego OWNER; własny panel i API
   działają, API pozostałych ról i administracji odmawia dostępu.
7. Limit prób rejestracji BFF odmawia po przekroczeniu progu.

Test wygaśnięcia ustawił czas wysłania wiadomości ponad dwie godziny wstecz
**tylko dla nowo utworzonego konta fikcyjnego**, przy jawnym OTP expiry 3600 s.
Nie zmieniano zegara ani istniejących kont. To test walidacji wygaśnięcia GoTrue,
nie rzeczywiste oczekiwanie godzinę i nie pomiar TTL na Contabo.

Przed testem kontrola przestrzeni PASS: osobny `/tmp`, Docker data-root w puli,
ponad 12 GiB wolnego, zachowana rezerwa `/`. Wszystkie kontenery bieżącego fixture
zatrzymano i potwierdzono brak uruchomionych usług w izolowanym daemonie; daemon
też zatrzymano. Bazy, poprzednie próby i wolumeny zachowano. Oryginalne lokalne
usługi właściciela pozostały uruchomione.

Pierwsze próby testów zatrzymały się na uprawnieniach kopii skryptu pod umask 077
oraz błędnej nazwie tabeli w teście. Naprawiono runner, nie produkcję. Nowe kopie
niesekretnego kodu testowego dostały jawne uprawnienia odczytu. Nie użyto chmod
na istniejącej konfiguracji ani danych. Ostateczny pełny test zakończył się PASS.

**5/5 testów nowego diagnostyka READ ONLY PASS**: nieujawnianie sekretów, brak
uznawania konfiguracji za dowód dostarczenia, odmowy przy brakujących flagach,
wewnętrzna sieć Auth i blokady no-mail. Dane wynikowe:
[MAIL-ONBOARDING-READINESS-RESULTS.json](MAIL-ONBOARDING-READINESS-RESULTS.json).

Są to testy lokalnego HTTP/SMTP capture. **Nie testowano Gmaila, zewnętrznego TLS
SMTP, dostarczenia do skrzynki ani ponownie całego interfejsu w przeglądarce.**
Wcześniejsze H1/H2 i public-profile regression pozostają historycznymi wynikami;
nie wliczono ich do nowych 7/7.

## Braki przed publiczną aktywacją

- Odczyt aktualnych flag aplikacji/Auth oraz DNS na Contabo. Przygotowano
  `scripts/mail-onboarding-audit.mjs --ssh`: nie wysyła i nie uwierzytelnia SMTP,
  nie kopiuje baz, nie zmienia checkoutu, usług ani plików serwera. Pokazuje tylko
  flagi, obecność poświadczenia, zatwierdzonego nadawcę i stan sieci. Klucz nie
  trafia do wyniku. Komenda z przypiętym SHA i SHA-256 jest w raporcie wykonania.
- Potwierdzona autoryzacja Gmail SMTP. Jeśli konto Google udostępnia hasła
  aplikacji, sekret wpisuje się wyłącznie lokalnie na serwerze w zatwierdzonym
  instalatorze, nigdy w rozmowie. Zwykłe hasło Gmail nie jest obsługiwane.
  Nie zadeklarowano gotowej integracji Google OAuth SMTP.
- Kontrolowany profil wysyłki oraz wyjście SMTP Auth z zachowaniem braku portów
  publicznych, TLS i całej konfiguracji DB/JWT/sesji/MFA.
- Jawne TTL, limity prób i wysyłki oraz obsługa ponownego wysłania potwierdzenia.
  BFF ma limit 40 żądań / 5 min / IP, pamięć pojedynczego procesu i CSRF.
  Nie ma wdrożonej CAPTCHA ani trwałego limitera rozproszonego dla signup.
  Honeypot formularza kontaktowego nie zabezpiecza formularza rejestracji.
  Osobnego przycisku/endpointu resend w aktywnym trybie nie potwierdzono; należy
  wybrać i przetestować czytelny proces dla wygasłego/niedostarczonego linku.
- Retencja zgłoszeń i adresatów testowych, minimalizacja logów, kontrolowany test
  dostarczenia i nagłówków SPF/DKIM/DMARC oraz pozytywna decyzja OWNER.

Publiczny reset dotyczy zwykłych kont. Konto OWNER nadal używa istniejącej
kontrolowanej procedury odzyskania samego hasła z zachowaniem TOTP. Nie będzie
wyłączenia MFA ani automatycznej zmiany uprawnień.

## Jedna procedura późniejszego wdrożenia — projekt, NIE URUCHAMIAĆ

1. READ ONLY: sprawdzić runtime i DNS nowym diagnostykiem. Nie wznawiać OAuth
   recovery i nie przenosić jego checkpointu w ramach poczty.
2. Po osobnym zatwierdzeniu: przygotować wersjonowany profil SMTP/testowej
   allowlisty oraz manifest zależności aktywnego R1 i gatewaya n8n. Zachować
   project/volumes, CA, JWT, klucze sesji i proxy, DB oraz wszystkie 21 migracji.
   Stary APP-ONLY aktualizuje tylko obraz, więc **nie wystarcza** do zmiany SMTP
   i sieci Auth. Nie uruchamiać pełnego starego production:deploy ani ręcznie
   edytować fingerprintów. Obecny generator smtp/no-mail nie stanowi gotowego
   kontrolowanego instalatora przejścia działającego R1 do SMTP.
3. Świeże OWNER MFA, zaszyfrowane kopie DB/konfiguracji/certów, weryfikacja kopii
   poza VPS i zapis poprzednich obrazów/manifestów. Bez resetu i bez migracji.
4. W kontrolowanym oknie przełączyć tylko zatwierdzone ustawienia app/Auth i
   minimalną sieć wyjściową SMTP. Ograniczyć testy do jawnie zatwierdzonych
   adresów; rejestracja publiczna nadal zamknięta dla pozostałych adresatów.
   Nie reklamować testowej allowlisty jako otwartej rejestracji.
5. Rzeczywiste potwierdzenie wiadomości i resetu na zatwierdzonych skrzynkach,
   poprawnej domeny, jednorazowości i TTL; test istniejącego OWNER/TOTP. Dopiero
   wtedy osobna zgoda na otwarcie publicznej rejestracji. Bez mailingu handlowego.

**Rollback konfiguracji:** przy błędzie zamknąć onboarding przez przywrócenie
poprzedniego, zaakceptowanego profilu no-mail i poprzedniej konfiguracji sieci
Auth/app. Zachować nowe konta i wnioski. Nie odtwarzać starej DB na produkcji,
nie usuwać wolumenów i nie cofać migracji. Sprawdzić istniejące logowanie/MFA,
health, n8n i ponowne blokady ścieżek mailowych. Ten nowy rollback SMTP **nie był
wykonany**; musi zostać sprawdzony w izolacji po przygotowaniu właściwego
instalatora. Historyczny rollback obrazu nie jest jego testem.
