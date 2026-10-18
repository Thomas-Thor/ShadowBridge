# ShadowBridge V2 — rejestracja, uprawnienia i hosting

Data opracowania: 18.10.2026. Dokument jest propozycją kolejnego etapu do zatwierdzenia. Nie utworzono projektu Supabase, kont dostawców, backendu ani publicznej rejestracji. Nie zmieniono hostingu, DNS ani źródła publikacji GitHub Pages.

## 1. Decyzja architektoniczna

Rekomendacja: oddzielić publiczną witrynę od aplikacji obsługującej dane firm. Publiczny frontend pozostaje lekki i statyczny; aplikacja korzysta z Supabase Auth, PostgreSQL i małego serwera pośredniczącego (BFF, backend dla przeglądarki). BFF może działać jako Cloudflare Worker. Supabase zapewnia tożsamość i bazę danych, a reguły biznesowe oraz uprawnienia pozostają jawnie zdefiniowane przez ShadowBridge.

Przepływ docelowy:

```text
Przeglądarka
  ├─ publiczna strona i zasoby statyczne
  └─ /app oraz /api na tym samym originie
       └─ BFF: walidacja, sesje, CSRF, ograniczenia żądań
            ├─ Supabase Auth: hasła, potwierdzenie email, odzyskiwanie
            ├─ PostgreSQL: profile, firmy, członkostwa, role, RLS
            ├─ SMTP: wiadomości transakcyjne
            └─ osobne adaptery integracji — dopiero w przyszłości
```

Warstwa publiczna może być wdrażana niezależnie od paneli. Panel nie otrzymuje prywatnych danych w HTML, plikach JS, plikach JSON ani danych demonstracyjnych przypominających rzeczywistych klientów. Ukrycie elementu CSS lub przekierowanie w JavaScript poprawia interfejs, lecz nie stanowi zabezpieczenia.

## 2. Model danych i rzeczywiste role

| Encja | Przeznaczenie i ograniczenia |
| --- | --- |
| `auth.users` | Tożsamości zarządzane przez Supabase; hasła nie trafiają do tabel aplikacji. |
| `profiles` | `user_id`, nazwa, język, dane kontaktowe, status konta. Użytkownik edytuje tylko dozwolone pola profilu. |
| `companies` | Nazwa prawna, kraj, strona, identyfikatory podatkowe, branże i opis działalności. Status weryfikacji zmienia uprawniony operator. |
| `company_memberships` | Powiązanie użytkownika z firmą i uprawnienie w jej obrębie. Zaproszenia i przejęcie członkostwa zatwierdza serwer. |
| `role_requests` | Żądanie dostępu jako `buyer`, `supplier` albo `agent`. Deklaracja formularza nie jest nadaniem roli. |
| `role_grants` | Autorytatywne role `buyer`, `supplier`, `agent`, `admin`, ich status i historia nadania/cofnięcia. Brak bezpośredniej edycji przez klienta. |
| `agent_applications` | Zgłoszenie agenta i stany `pending`, `approved`, `rejected`, `suspended`; decyzja, autor i czas. |
| `app_sessions` | Serwerowy rejestr aktywności/cofnięcia sesji związany z `session_id` z JWT, bez zapisywania haseł ani surowych tokenów. |
| `inquiries`, później `opportunities` i `assignments` | Zapytania oraz przypisanie konkretnych spraw firmom i agentom. Agent widzi wyłącznie przypisane rekordy. |
| `audit_events` | Zmiany uprawnień, zatwierdzenia i operacje administracyjne; bez treści haseł, tokenów i zbędnych danych osobowych. |

Jedna firma może kupować i sprzedawać; model dopuszcza kilka nadanych ról. W interfejsie początkowym wybiera się jedną ścieżkę, ale nie ogranicza to przyszłej struktury. Uprawnienie w firmie i rola agenta są odrębnymi pojęciami. Stary identyfikator `client` będzie mapowany na biznesową rolę `buyer` w adapterze migracyjnym; istniejące pliki i odwołania nie wymagają natychmiastowego przemianowania.

## 3. Rejestracja i zatwierdzanie agenta

1. BFF waliduje dane, ogranicza częstotliwość i przyjmuje żądaną ścieżkę bez pól nadających uprawnienia. Na etapie przeciwdziałania nadużyciom można dodać sprawdzany po stronie serwera mechanizm antybotowy.
2. Supabase Auth tworzy konto z wymaganym potwierdzeniem email. Formularz informuje o konieczności potwierdzenia; nie deklaruje aktywnego dostępu do panelu. Błędy i odpowiedzi ograniczają możliwość ustalania, czy dany email istnieje.
3. Po poprawnym potwierdzeniu i logowaniu serwer tworzy lub kończy profil, firmę i żądanie roli. Operacje aplikacyjne są idempotentne, a zmiany w bazie wykonywane transakcyjnie; nie mogą pozostawić aktywnej roli bez wymaganego profilu. Nieudany krok daje stan oczekujący i możliwość bezpiecznego ponowienia.
4. Dla `buyer` i `supplier` można zatwierdzić dostęp do własnego profilu po weryfikacji email. Status zweryfikowanej firmy jest osobną decyzją; samo potwierdzenie email nie potwierdza legalności przedsiębiorstwa.
5. Kandydat na agenta widzi własny wniosek i jego status. Nie otrzymuje danych klientów, ofert ani kontaktów agentów.
6. Administrator z aktywną rolą `admin` i MFA zatwierdza wniosek przez chroniony endpoint. Serwer ponownie sprawdza aktualne uprawnienia, zapisuje decyzję i nadaje rolę w jednej transakcji z wpisem audytowym. Powtórzone żądanie nie nadaje roli ponownie.
7. `admin` nie jest opcją formularza rejestracji. Pierwszego administratora ustanawia kontrolowana operacja operatora dla konkretnej, zweryfikowanej tożsamości; dalsze nadania są audytowane.

Nie wolno użyć `user_metadata`, pola formularza, parametru URL lub `localStorage` jako źródła roli administracyjnej. Zmiana `role=admin`, `status=approved` albo identyfikatora firmy w żądaniu nie może zmienić uprawnień.

## 4. RLS i izolacja danych

Włączyć Row Level Security na wszystkich tabelach udostępnionych przez Data API. Dla nowych tabel punktem wyjścia jest brak dostępu. Wymagane polityki i uprawnienia kolumn:

- Anonimowy użytkownik nie odczytuje profili, firm, członkostw, wniosków i spraw handlowych. Publiczne materiały marketingowe nie wymagają takich uprawnień.
- Użytkownik odczytuje własny profil, a aktualizacja obejmuje wyłącznie zatwierdzone pola. Pola statusu, uprawnień, właściciela i weryfikacji nie są zapisywalne tą ścieżką.
- Dane firmy są dostępne wyłącznie aktywnym członkom tej firmy. Właściciel nie może dołączyć innej osoby lub przenieść rekordu do obcej firmy dowolnym `company_id`.
- Agent musi mieć aktualnie zatwierdzoną rolę i aktywne przypisanie do danej sprawy. Samo posiadanie roli nie otwiera całej bazy kontaktów.
- Role i status konta sprawdza się w autorytatywnych tabelach. Roszczenia JWT mogą wspomagać interfejs, ale nie zastępują bieżącej decyzji serwera o cofniętych uprawnieniach.
- Wszystkie chronione operacje wymagają również aktywnej sesji. Prywatna funkcja pomocnicza może sprawdzać `session_id` i `user_id` względem `app_sessions`; klient nie może tworzyć lub aktywować takich wpisów. Samo wygaszenie interfejsu panelu nie wystarcza.
- Polityki `SELECT`, `INSERT`, `UPDATE` i `DELETE` wymagają osobnych testów, w tym `WITH CHECK`, zapytań bezpośrednio do Data API i zmiany identyfikatorów zasobów. Widoki, funkcje RPC i Storage muszą zachowywać te same ograniczenia.

Zwykłe operacje BFF powinny używać JWT konkretnego użytkownika, aby RLS obowiązywało także za serwerem. Sekretny klucz Supabase omija RLS: jest dopuszczony tylko w oddzielonych, wąskich operacjach administracyjnych po sprawdzeniu operatora. Funkcje `SECURITY DEFINER` wymagają stałego `search_path`, kwalifikowanych nazw i minimalnych uprawnień `EXECUTE`; nie mogą zamienić się w ogólny endpoint SQL.

## 5. Sesje, odzyskiwanie i cofanie dostępu

Preferowana sesja przeglądarki: cookie `HttpOnly`, `Secure`, host-only i `SameSite=Lax`, bez tokenu w `localStorage`. BFF przechowuje tokeny w bezpiecznym magazynie sesji lub w uwierzytelnionych, szyfrowanych cookies z rotowanym kluczem. Wariant trzeba wybrać i przetestować przed implementacją. Dane tajne nie trafiają do publicznych zmiennych budowania ani artefaktów frontendu.

Każdy chroniony request weryfikuje ważność podpisu JWT, `iss`, `aud`, `exp`, aktualny status konta, sesji i roli. Użyć oficjalnego SDK i poprawnej obsługi rotacji kluczy; samo dekodowanie JWT nie jest weryfikacją. Nie implementować własnej kryptografii.

Wymagane mechanizmy:

- Krótki czas życia access tokenu, rotacja refresh tokenów i kontrolowane odświeżanie. Ustawić konkretny czas po sprawdzeniu możliwości wybranego planu; limit bezczynności aplikacji może egzekwować własny rejestr sesji.
- CSRF token oraz weryfikacja `Origin` dla operacji zmieniających dane; CORS tylko dla zatwierdzonych originów. Brak wildcardu z cookies. Odpowiedzi paneli i API: `Cache-Control: no-store` i brak współdzielonego cache danych użytkowników.
- Wylogowanie: najpierw cofnięcie wpisu sesji aplikacji, następnie wylogowanie Supabase i usunięcie cookies. Operacja lokalnego wyczyszczenia pamięci nie jest unieważnieniem sesji serwera.
- „Wyloguj wszystkie urządzenia”, zawieszenie konta, cofnięcie roli i zmiana hasła: unieważnienie odpowiednich wpisów aplikacji oraz sesji/refresh tokenów Auth zgodnie z operacją. Zapis administracyjny musi być audytowany.
- JWT może pozostawać poprawny kryptograficznie do wygaśnięcia po wylogowaniu. Kontrola aktywności sesji i roli w RLS/BFF ma odrzucać takie tokeny natychmiast. Ten efekt wymaga osobnego testu, także bezpośrednio przez Data API.
- Odzyskiwanie hasła używa wiadomości Supabase i dokładnej listy dozwolonych redirectów. Tokeny i kody nie trafiają do logów, analityki ani nagłówka referer; po wymianie kodu URL jest czyszczony. Użytkownik otrzymuje jasny komunikat o stanie operacji.
- Obowiązkowe MFA dla administratorów i ponowne potwierdzenie przed operacjami wrażliwymi. Rate limits logowania, rejestracji, resend email i recovery, bez rejestrowania haseł ani pełnych tokenów.
- CSP, kodowanie danych do DOM, `textContent` zamiast niesprawdzonego HTML i kontrola zależności ograniczają ryzyko XSS. `HttpOnly` chroni odczyt cookie, ale nie zastępuje ochrony przed XSS.

## 6. Konfiguracja wymagana przed wdrożeniem backendu

Najpierw odrębne środowisko testowe; żadnej publicznej rejestracji w ramach bieżącego prototypu. Administratorzy kont dostawców wprowadzają wartości w menedżerach sekretów, nigdy w czacie ani repozytorium.

| Konfiguracja — wyłącznie nazwy | Gdzie i dlaczego |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | BFF; adres projektu i klucz publicznego klienta. Klucz publiczny nie nadaje uprawnień administratora. |
| `SUPABASE_SECRET_KEY` | Tylko sekret BFF, do ściśle wydzielonych operacji administracyjnych. Starszy odpowiednik to `SUPABASE_SERVICE_ROLE_KEY`; wybrać jeden wspierany wariant. |
| `DATABASE_URL` | Wyłącznie narzędzia migracji/CI, minimalna rola i bezpieczne połączenie. Nie trafia do przeglądarki. |
| `APP_ORIGIN`, `AUTH_CALLBACK_URL`, `AUTH_RECOVERY_URL` | Dokładne, odrębne adresy testowe i produkcyjne. Redirecty Supabase bez ogólnego wildcardu produkcyjnego. |
| `SESSION_ENCRYPTION_KEY` | Sekret serwera dla wybranego rozwiązania sesji, z planem rotacji. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Bezpieczna konfiguracja dostawcy wiadomości w Supabase; zweryfikowany nadawca. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Opcjonalna ochrona antybotowa; klucz prywatny wyłącznie po stronie serwera. |

Ponadto trzeba zatwierdzić region bazy (preferowany UE), operatora danych i zasady retencji, dostawcę SMTP, limit kosztów i właścicieli kont. Potrzebne są migracje SQL, backupy oraz sprawdzone odtwarzanie. Supabase zapewnia infrastrukturę, lecz konfiguracja RLS i autoryzacja pozostają obowiązkiem aplikacji.

Weryfikacja domeny nadawcy może wymagać SPF, DKIM i DMARC oraz zmian DNS; niczego nie dodano. Wbudowany mailer Supabase ma ograniczenia i nie powinien być zakładany jako docelowa dostarczalna poczta dla otwartej rejestracji. Najpierw własny SMTP i testy odbioru email, potwierdzenia i recovery na kilku skrzynkach. Nie zakładać obecności żadnej z powyższych wartości: nie proszono o sekrety i nie wykonywano provisioningu.

## 7. Istniejące panele i migracja

Zachować pliki agenta, klienta i dostawcy. Nowy adapter domenowy rozdzieli wyświetlanie istniejących komponentów od źródła danych. Każdą funkcję przenosić oddzielnie: sesja → profil → dane panelu → zapisy → pozostałe operacje. Nie zastępować paneli obrazami ani ogłaszać ich gotowości po samym podpięciu formularza.

`localStorage` z istniejącego demo nie jest bazą klientów. Nie importować automatycznie haseł, fikcyjnych użytkowników, ról, obrotów lub przykładów transakcji. Prawdziwe konta muszą przejść nową rejestrację albo zweryfikowane zaproszenie. Jeżeli właściciel potwierdzi istnienie rzeczywistych rekordów w starym backendzie, osobno uzgodnić zakres eksportu, podstawę prawną, mapowanie, deduplikację i odwracalny import w stagingu.

Tryb demonstracyjny musi być jawnie oznaczony i odseparowany od produkcji. Nie wolno dopuścić, aby brak backendu przełączał aplikację na fikcyjny sukces. Usuwanie danych lokalnych przeglądarki również wymaga jasnej ścieżki migracji; nie czyścić automatycznie nieznanej zawartości użytkownika. Ten dokument nie zmienia istniejących dashboardów.

## 8. Wyniki przeglądu bezpieczeństwa istniejącego repozytorium

Punkt odniesienia: `6db80ad`. Sprawdzono śledzone pliki oraz 73 osiągalne commity — 63 unikalne bloby, łącznie 1 189 493 bajty. Skan heurystyczny obejmował typowe klucze GitHub/AWS/Stripe/Supabase, klucze prywatne, literały JWT, przypisania sekretów i dane uwierzytelniające w URL. Plik `docs/ShadowBridge Platform v2.0.pdf` jest w rzeczywistości tekstem UTF-8, więc został objęty skanem jako tekst; `pdftotext` potwierdził brak prawidłowego PDF. Wynik: **nie wykryto dopasowań sugerujących ujawniony sekret**. Nie drukowano wartości, plików poświadczeń ani środowiska procesu. To nie jest gwarancja braku sekretów: skan nie obejmuje nieosiągalnych obiektów Git, cudzych forków, zewnętrznego serwera, konfiguracji kont ani wszystkich możliwych formatów sekretów.

Potwierdzone problemy projektowe w punkcie odniesienia, przed naprawami statycznego preview V2 (numery linii dotyczą tej wersji):

| Lokalizacja | Ustalenie i skutek |
| --- | --- |
| `scripts/script.js:103` i `:128` | `simulateLogin()` nie uwierzytelnia hasła; `checkAuth()` ufa istnieniu wpisu `cartelUser`. Osoba kontrolująca przeglądarkę może sfałszować ten stan. |
| `clients/client-dashboard.js:55`, `suppliers/supplier-dashboard.js:55` | Formularze symulują rejestrację, zapisują rolę i dane w `localStorage`, po czym deklarują sukces. To nie trwały zapis serwera ani decyzja o uprawnieniach. |
| `api-client.js:6`, `:42`, `:154` | Token i profil są przechowywane w `localStorage`; podatność na XSS może je ujawnić. `logout()` jedynie czyści lokalne dane, bez wywołania unieważniającego sesję. |
| `api-client.js:4` | Zakodowany zewnętrzny endpoint środowiska deweloperskiego. Jest adresem publicznym, nie sekretem; brak dowodu sprawnego backendu i brak jego kodu w repozytorium. |
| `index.html:453`, `docs/index.html:454`, `docs/script-simplified.js:142` | Parametr `access=cartel` pokazuje sekcję strony. Nie jest kontrolą autoryzacji; treść i tak znajduje się w statycznym HTML. Nie znaleziono tu dowodu wycieku rzeczywistych prywatnych rekordów. |
| `quick-register.html:44` | Komunikat sukcesu bez wysyłki danych. Nie może służyć jako działająca rejestracja. |
| `agent-dashboard.js:271` | Wniosek agenta jest logowany do konsoli. W integracji produkcyjnej dane osobowe i handlowe należy wyłączyć z takich logów. |
| Wspólne skrypty i panele | Niespójne `cartelUser`/`cartel_user` i `checkAuth()`/`isAuthenticated()` utrudniają poprawną obsługę stanu; żaden z tych lokalnych warunków nie zastąpi RLS. |

Nie stwierdzono ujawnienia sekretu, więc nie deklaruje się incydentu ani potrzeby rotacji konkretnego klucza bez dowodów. Przed przyszłym podłączeniem backendu włączyć skanowanie zmian i historii przez uzgodnione narzędzie oraz sprawdzić ustawienia GitHub secret scanning, jeżeli są dostępne.

## 9. Hosting, koszty i publikacja GitHub Pages

**Źródło Pages pozostaje niepotwierdzone.** W repozytorium znajdują się `index.html` oraz `docs/index.html`, plik `CNAME`, a brak śledzonego workflow `.github/workflows`. To nie dowodzi konfiguracji źródła publikacji: GitHub może publikować z gałęzi albo Actions. Próba odczytu API repozytorium, `/pages` i `/actions/workflows` została zablokowana przez proxy środowiska. Nie zmieniano ustawień ani DNS. Potwierdzenie wymaga odczytu Settings → Pages lub autoryzowanego `GET /repos/Thomas-Thor/ShadowBridge/pages`, zwłaszcza `build_type` i `source.branch`/`source.path`.

Technicznie GitHub Pages obsłuży publiczne HTML/CSS/JS/SVG i zewnętrzne API, ale nie serwer, bazę i bezpieczny BFF. Jego zasady ograniczają używanie usługi jako darmowego hostingu biznesu online, handlu elektronicznego i stron nastawionych na transakcje. Nie należy z tego wyprowadzać automatycznego zakazu każdej wizytówki firmy. Docelową komercyjną platformę z kontami rekomenduję umieścić u dostawcy dopuszczającego taki zakres, po sprawdzeniu aktualnych warunków.

**Status cenników:** 18.10.2026 próby pobrania oficjalnych źródeł zakończyły się odpowiedzią proxy `403 Forbidden`. Poniższe kwoty są orientacyjnymi, niezweryfikowanymi punktami budżetowymi w USD, bez podatków; nie stanowią aktualnej oferty ani potwierdzenia limitów. Przed zakupem sprawdzić cennik konta, region, rozliczenie miesięczne/roczne, limity i bieżące zasady zastosowania komercyjnego.

| Wariant | Orientacyjny koszt | Zastosowanie i kompromisy |
| --- | --- | --- |
| Cloudflare Pages + Workers + Supabase | Statyczny frontend może mieścić się w planie 0 USD; płatny Workers historycznie od ok. 5 USD/mies. Supabase Pro historycznie od ok. 25 USD/mies. | Rekomendowany kierunek: niedrogi frontend, BFF na tym samym originie, zarządzane Auth i baza. Wymaga sprawdzenia limitów żądań, CPU i regionu danych. |
| Supabase Free do zamkniętego testu | 0 USD w zakresie dostępnych limitów | Dobre do testów, bez zakładania SLA, backupów produkcyjnych lub nieprzerwanej pracy; historyczne ograniczenia obejmowały pauzowanie nieaktywnych projektów i małą bazę. Aktualnych limitów liczbowych nie potwierdzono. |
| Vercel Pro + Supabase | Pro historycznie od ok. 20 USD/stanowisko/mies. + Supabase od ok. 25 USD/mies. | Wygodne preview i backend funkcji. Dla projektu komercyjnego nie zakładać planu Hobby; sprawdzić warunki i koszty użycia. |
| Netlify + Supabase | Wymaga sprawdzenia aktualnego cennika planów i kredytów + koszt Supabase | Wygodne preview i funkcje, lecz nie obiecywać kosztu 0 USD ani nieweryfikowanych dawnych limitów. |
| VPS w UE | Orientacyjnie 5–20 USD/mies. za małą maszynę, dodatkowo poczta, kopie i obsługa | Pełna kontrola, ale aktualizacje, TLS, baza, backupy i dyżur administracyjny obciążają operatora. Najniższa cena serwera nie oznacza najniższego kosztu utrzymania. |

Praktyczny budżet małego startu z zarządzanym backendem: **około 30–60 USD miesięcznie**, przed podatkami, przy niewielkim ruchu i pojedynczym płatnym projekcie; to szacunek do weryfikacji. Poczta, domena, dodatkowe środowiska, większy compute, egress, przechowywanie i monitoring mogą zwiększyć koszt. Koszt pracy wdrożeniowej i utrzymania jest oddzielny. Osobny płatny staging nie jest automatycznie zawarty w tej kwocie.

Przy wzroście monitorować rozmiar bazy, aktywnych użytkowników, liczbę i czas funkcji, transfer, SMTP i koszty kopii. Skonfigurować alerty i dostępne limity kosztów; nie obiecywać twardego limitu, którego dostawca nie gwarantuje.

## 10. Przyszłe CRM i agenci AI — granica integracji

Nie implementowano połączeń z Google Sheets, Relevance AI, Clay ani Apollo. Przyszłe adaptery działają wyłącznie po stronie serwera. Każdy dostawca otrzymuje osobny sekret i minimalne uprawnienia. Frontend odwołuje się do identyfikatorów własnej aplikacji, nie do prywatnych arkuszy lub tokenów.

Importy i webhooki wymagają uwierzytelnienia, weryfikacji podpisu, limitów, idempotencji, kolejki i kontrolowanych ponowień. Zewnętrzna treść jest niezaufana: nie może sama zmieniać ról, ujawniać danych firm ani inicjować działań administracyjnych. Rekomendacja AI jest osobnym rekordem wymagającym sprawdzenia, nie automatyczną akceptacją kontrahenta. Uzgodnić zgodę na przetwarzanie, retencję i zakres danych przekazywanych każdemu dostawcy.

## 11. Etapy i kryteria odbioru backendu

1. **Decyzja i sandbox:** zaakceptowany model ról, region, budżet, operatorzy, SMTP i konfiguracja callbacków. Zamknięte środowisko testowe, bez wpływu na aktualną produkcję. Sekrety wyłącznie w magazynach dostawców.
2. **Migracje i RLS:** odtwarzalna pusta baza; testy co najmniej użytkowników A/B w różnych firmach, agenta oczekującego/zatwierdzonego/zawieszonego i administratora. Sprawdzić wszystkie operacje, RPC i bezpośrednie Data API. Brak uprawnień przy manipulacji rolą, `company_id` i `user_id`.
3. **Auth i email:** prawdziwy zapis konta, potwierdzenie email, brak dostępu przed potwierdzeniem, poprawne logowanie, błędne hasło, duplicate email, recovery, wygasły i ponownie użyty link, bezpieczne redirecty i działające rate limits. Sukces interfejsu dopiero po potwierdzonym wyniku serwera.
4. **Role i sesje:** agent oczekujący bez danych biznesowych, nadanie roli wyłącznie przez aktywnego administratora z MFA; audyt, cofnięcie, ponowna autoryzacja. Wylogowanie pojedynczej/wszystkich sesji, odświeżanie, utrata ważności, zmiana hasła, zablokowane konto. Stary JWT nie daje dostępu po revokacji.
5. **Profile i panele:** dwa realne konta testowe zachowują odrębne profile po wylogowaniu i ponownym logowaniu na innym urządzeniu. Osobno odtworzyć dane agenta, kupującego i dostawcy. Brak danych demo w odpowiedziach produkcyjnych i brak osobistych danych/tokenów w konsoli oraz logach.
6. **Odporność i gotowość operacyjna:** brak fałszywego sukcesu przy awarii Auth/bazy/SMTP, retry bez duplikatów, test kopii i odtworzenia, nagłówki bezpieczeństwa, CSRF/XSS, cache i kontrola kosztów. Właściciel akceptuje politykę prywatności, retencję, procedury wsparcia i plan migracji.
7. **Osobna zgoda na uruchomienie:** dopiero po wynikach powyższych testów zatwierdzić włączenie publicznej rejestracji, zmianę hostingu, DNS lub publikację. Żadne z tych działań nie jest częścią bieżącego prototypu.

## 12. Oficjalne źródła do sprawdzenia przed zatwierdzeniem usług

Poniższe URL wskazują dokumentację dostawców. Ich treść/cennik nie zostały pobrane w tej sesji z powodu blokady proxy; nie stanowią potwierdzenia aktualnych limitów na dzień opracowania.

- Supabase: [cennik](https://supabase.com/pricing), [Auth](https://supabase.com/docs/guides/auth), [sesje](https://supabase.com/docs/guides/auth/sessions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [role i RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac), [własny SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [klucze API](https://supabase.com/docs/guides/api/api-keys).
- Cloudflare: [Pages — limity](https://developers.cloudflare.com/pages/platform/limits/), [Functions — rozliczenie](https://developers.cloudflare.com/pages/functions/pricing/), [Workers — cennik](https://developers.cloudflare.com/workers/platform/pricing/).
- Vercel: [cennik](https://vercel.com/pricing), [plan Hobby i zakres zastosowania](https://vercel.com/docs/plans/hobby).
- Netlify: [cennik](https://www.netlify.com/pricing/).
- GitHub: [ograniczenia Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [REST API konfiguracji Pages](https://docs.github.com/en/rest/pages/pages#get-a-github-pages-site).
