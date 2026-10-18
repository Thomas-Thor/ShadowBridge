# ShadowBridge V2 — przygotowanie publikacji i ustalenia hostingu

Stan sprawdzenia: 18.10.2026. Dokument opisuje przygotowanie i przyszłą procedurę. **Nie wykonano publikacji, zmiany DNS, hostingu, źródła GitHub Pages, merge ani aktywacji rejestracji.** Prace pozostają na `feature/shadowbridge-v2`.

## Co zostało potwierdzone

| Ustalenie | Dowód i granica wniosku |
| --- | --- |
| Repozytorium to `Thomas-Thor/ShadowBridge`; domyślny zdalny ref to `main`. | Odczyt `git ls-remote --symref origin HEAD`. |
| Początkowy zdalny `main` wskazywał `6db80adf54a2793bb5c792c9829b2683dca8f2a3`, a zdalna gałąź V2 `d0ac38a6ed1fa10beca0533cc0777630a14b46ca`. | Odczyt `git ls-remote --heads origin main feature/shadowbridge-v2` przed bieżącymi poprawkami. To stan Git, nie dowód wdrożenia tych commitów. |
| Śledzony plik `CNAME` w katalogu głównym zawiera `shadow-bridge.eu`. | Lokalny plik oraz odczyt `https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/main/CNAME`. Jego treść jest zgodna z konfiguracją Pages podaną przez właściciela poniżej; sam plik nie jest dowodem konfiguracji DNS. |
| Dotychczasowa gałąź `main` zawiera oba pliki `index.html` i `docs/index.html`; nie zawiera śledzonego workflow `.github/workflows`. | Odczyt drzewa `origin/main`. Właściciel osobno potwierdził publikację z katalogu głównego `main`, więc produkcyjnym plikiem wejściowym jest obecny `index.html` w root. |
| Obecny prototyp publiczny jest statycznym HTML/CSS/JS/SVG z lokalnymi fontami. | Przegląd struktury `v2/`. Publiczna prezentacja nie wymaga uruchamiania backendu, lecz nie zapewnia działających kont użytkowników ani wysyłki formularzy. |

## Konfiguracja potwierdzona przez właściciela

Właściciel odczytał bieżące ustawienia GitHub i przekazał następujący stan. Jest to **potwierdzenie właściciela na podstawie panelu**, a nie niezależny odczyt API, DNS lub TLS wykonany w tym środowisku:

| Ustawienie | Stan podany przez właściciela |
| --- | --- |
| Hosting | GitHub Pages. |
| Source | Deploy from a branch. |
| Branch i folder | `main`, `/(root)` — katalog główny repozytorium; nie katalog `/root` systemu Linux. |
| Custom domain | `shadow-bridge.eu`. |
| DNS check | Successful. |
| Enforce HTTPS | Enabled. |
| Aktualna strona | Działa i jest publicznie dostępna. |
| Rejestrator domeny | Porkbun; zakup 09.06.2025 za 14,78 USD. Kwota dotyczy zakupu podanego przez właściciela, nie ceny odnowienia ani hostingu. Data wygaśnięcia nie została podana. |

Z tego wynika, że obecna homepage jest publikowana z **`main:/index.html`**. Sam push `feature/shadowbridge-v2` jej nie zastępuje. **Zwykły merge gałęzi z frontendem w `v2/` także nie ustawi V2 jako homepage**: nie przenosi `v2/index.html` do root i nie zmienia źródła Pages. Takiego merge ani przenoszenia plików nie wykonano. Zmiany śledzonych plików root na `main` mogłyby uruchomić obecną publikację, dlatego nie są częścią przygotowania paczki.

Porkbun pozostaje rejestratorem domeny. Rejestrator nie musi być dostawcą autorytatywnych DNS; bez rekordów NS nie ustalono, kto obecnie obsługuje strefę. Migracja hostingu nie wymaga przenoszenia rejestracji domeny do innej firmy.

## Granice niezależnej weryfikacji i pozostałe dane

- `GET https://api.github.com/repos/Thomas-Thor/ShadowBridge/pages` zakończył się odmową proxy środowiska: `CONNECT tunnel failed, response 403`. Nie uzyskano odpowiedzi API GitHub. Źródło publikacji, domena i Enforce HTTPS są obecnie znane z potwierdzenia właściciela, a nie z tej próby API.
- Próby HTTP/HTTPS do `shadow-bridge.eu`, HTTPS do `www.shadow-bridge.eu` i adresu `thomas-thor.github.io/ShadowBridge/` również zatrzymał proxy. Nie są to dowody błędu 403 serwowanej witryny ani braku strony.
- Lokalny resolver zwracał `Temporary failure in name resolution`, również dla `thomas-thor.github.io`. Nie otrzymano rekordów DNS domeny; nie można na tej podstawie stwierdzić błędnej konfiguracji domeny.
- Nie uzyskano połączenia TLS z domeną, więc nie potwierdzono niezależnie certyfikatu, nazwy hosta, dat ważności ani łańcucha zaufania. Właściciel potwierdził włączone Enforce HTTPS i działającą stronę; nie jest to wynik pomiaru certyfikatu w tym środowisku. Nie wyłączano weryfikacji TLS.
- Publiczne widoki deployments zwracały 404. Nie dowodzi to, że wdrożenia nie istnieją lub że repozytorium nie korzysta z Pages.

Do przygotowania ewentualnego przełączenia pozostają potrzebne **bez haseł i tokenów**:

1. Autorytatywne rekordy NS oraz kopia strefy: A/AAAA/CNAME dla `@` i `www`, MX, TXT, CAA i pozostałe istniejące rekordy; status DNSSEC/DS. Nie wolno zakładać, że DNS prowadzi Porkbun.
2. Stan `www.shadow-bridge.eu`, preferowana wersja kanoniczna domeny i ewentualne przekierowania. Dla obecnej paczki docelową domeną jest `https://shadow-bridge.eu/`; przed publikacją trzeba zatwierdzić również zachowanie `www`.
3. Data wygaśnięcia domeny, status automatycznego odnowienia i właściciel konta operatora DNS; bez danych logowania. Brak tych informacji nie blokuje lokalnych poprawek ani przeglądu paczki.
4. Potwierdzenie docelowego konta hostingowego, dopuszczalnego planu i właściciela rozliczeń przed utworzeniem jakiejkolwiek usługi.

## GitHub Pages a zastosowanie komercyjne

Oficjalna dokumentacja GitHub Pages została odczytana przez oficjalne repozytorium `github/docs`; bezpośredni serwis dokumentacji był blokowany przez proxy. Zasady mówią, że Pages nie jest przeznaczony ani dozwolony jako bezpłatny hosting biznesu online, e-commerce ani witryn nastawionych przede wszystkim na ułatwianie transakcji komercyjnych lub komercyjny SaaS. Nie należy utożsamiać tego automatycznie z zakazem każdej informacyjnej wizytówki firmy. Dla rozwoju ShadowBridge jako platformy brokerskiej rekomendowany jest hosting przeznaczony także do obsługi stron i aplikacji komercyjnych.

Technicznie Pages obsługuje statyczne zasoby V2, ale nie uruchamia serwera aplikacji, bazy danych ani bezpiecznej rejestracji. Zmiana plików V2 nie jest potwierdzeniem zgodności obecnego sposobu użycia usługi z jej warunkami. Nie zmieniono obecnego hostingu.

Źródło: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [odczytany plik źródłowy GitHub](https://raw.githubusercontent.com/github/docs/main/content/pages/getting-started-with-github-pages/github-pages-limits.md).

## C.A.R.T.E.L. Division — obecny zakres i przyszłe zaproszenia

Obecny `/cartel/` jest wyłącznie publiczną stroną informacyjną, bez skryptów uwierzytelniania, kont, danych członków, haseł lub kodów dostępu. Parametry takie jak `access=cartel`, `role=admin` i `preview=1` nie zmieniają jej treści ani uprawnień. `noindex` nie jest zabezpieczeniem: na tej stronie nie wolno umieszczać danych prywatnych.

Przyszły portal wymaga osobnego projektu i zgody na backend. Właściciel będzie wystawiał indywidualne, odwoływalne zaproszenia po stronie serwera, powiązane z konkretnym adresem e-mail i zakresem dostępu. Token ma być losowy, jednorazowy i ograniczony czasowo; w bazie przechowuje się jego hash. Przyjęcie zaproszenia powinno wymagać zweryfikowanej tożsamości, atomowego oznaczenia wykorzystania oraz audytu. Użytkownik nie może sam nadać sobie roli ani członkostwa, a każde odczytanie prywatnych danych musi ponownie przejść autoryzację serwera/RLS. Sam parametr URL, kod w JavaScript, ukryta sekcja lub stan przeglądarki nie nadają dostępu. Tych mechanizmów nie zaimplementowano w bieżącym etapie.

## Przygotowana granica paczki produkcyjnej

Budowanie lokalne, bez publikacji:

```sh
npm --prefix v2 run build:production
```

Docelowy katalog w środowisku roboczym: `/workspace/exports/shadowbridge-v2-production`. Jego **zawartość** stanowi katalog główny witryny: `index.html`, `cartel/index.html`, `assets/`, `robots.txt`, `sitemap.xml` oraz ewentualne jawne reguły nagłówków `_headers`. `/cartel/` ma pozostać stroną informacyjną. W paczce nie mogą znaleźć się stare formularze rejestracji, panele, `api-client.js`, katalog `.git`, testy, materiały audytowe ani plik `CNAME` z konfiguracją obecnej usługi.

Do przeglądu paczki lokalnie, po wykonaniu buildu:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace/exports/shadowbridge-v2-production
```

Adresy do przeglądu na tej samej maszynie: `http://127.0.0.1:8000/` oraz `http://127.0.0.1:8000/cartel/`. Na własnym Linuxie należy podać lokalną ścieżkę do pobranego/utworzonego katalogu paczki. Serwer kończy pracę po Ctrl+C. Sam build i serwer lokalny nie publikują strony w Internecie.

Nie należy publikować ZIP całego repozytorium ani katalogu `review`: pierwszy zawiera zachowane stare aplikacje, drugi jest pakietem do lokalnej oceny. Do hostingu przeznaczony jest wyłącznie wynik `build:production`.

## Rekomendacja i przyszła procedura — wyłącznie po osobnej zgodzie

Rekomendacja techniczna dla statycznej witryny: **Cloudflare Pages, ręczny Direct Upload gotowej paczki**, po akceptacji dostawcy, warunków użycia, właściciela konta i ewentualnych kosztów. Oficjalna dokumentacja potwierdza obsługę statycznych plików, własnych domen, nagłówków i ręcznego wgrywania katalogu lub ZIP oraz opisuje plan Free z limitami. Lekka strona statyczna może mieścić się w tym zakresie, lecz nie jest to gwarancja kosztów ani aktualna oferta. Nie zakładano żadnego konta ani projektu. Nie zweryfikowano indywidualnej umowy lub planu konta właściciela; nie zaciągnięto zobowiązań finansowych. Alternatywą techniczną są Workers Static Assets; wybór produktu należy potwierdzić przy decyzji o publikacji, bez potrzeby zmiany statycznych plików V2.

Jeżeli właściciel nie chce przenosić autorytatywnych DNS dla domeny głównej, można osobno ocenić komercyjny hosting obsługujący apex z zewnętrzną strefą, np. Netlify. W tej sesji oficjalne strony warunków/cennika i konfiguracji DNS Netlify blokował proxy; nie zweryfikowano bieżących cen ani warunków zastosowania komercyjnego, dlatego nie przedstawia się go jako już zatwierdzonego dostawcy ani nie obiecuje bezpłatnego planu. Wybór takiej alternatywy wymaga porównania aktualnych warunków przed jakąkolwiek aktywacją. Sam Porkbun nie ustala wyboru hostingu.

Po zatwierdzeniu konkretnego wdrożenia:

1. Utrwalić zaakceptowany commit, wyniki testów i kopię obecnego wdrożenia wraz z konfiguracją. Zachować GitHub Pages z `main:/(root)` jako dotychczasową wersję i podstawę wycofania. Stary kod, formularze oraz panele pozostają w historii i plikach Git; nie trafiają do nowej publicznej paczki. Przygotowanie i wdrożenie odrębnego artefaktu nie wymaga merge do `main`.
2. Zbudować paczkę powyższą komendą. Sprawdzić root `/`, `/cartel/`, wszystkie zasoby, linki, mobilne menu i kontakt, brak wywołań backendu i brak działającej rejestracji. Zatwierdzić finalny adres kanoniczny i treść SEO.
   Do osobnego wdrożenia testowego użyć zamiast produkcji `npm --prefix v2 run build:preview`: wynik `/workspace/exports/shadowbridge-v2-preview` zachowuje `noindex, nofollow` i blokadę robots. Nie wgrywać indeksowalnej paczki produkcyjnej pod tymczasowy adres.
3. Jeżeli właściciel zatwierdzi osobną publikację testową, w jego koncie Cloudflare wybrać **Workers & Pages → Create application → Get started → Drag and drop your files**, utworzyć odrębny projekt i wgrać sam katalog `/workspace/exports/shadowbridge-v2-preview` albo ZIP jego zawartości, z `index.html` w root. W tym wariancie build wykonuje się wcześniej lokalnie; ustawienia zdalnego buildu i automatyczne wdrażanie po push nie są potrzebne. Uruchomienie przycisku Deploy jest publikacją i nie jest obecnie autoryzowane. Zatwierdzoną paczkę produkcyjną stosuje się dopiero do uzgodnionego docelowego wdrożenia dla domeny produkcyjnej.
4. Sprawdzić wynik pod nadanym adresem `https://<nazwa-projektu>.pages.dev`: HTTP, TLS, nagłówki, wszystkie zasoby, przekierowania i oba widoki responsywne. Dopiero rzeczywisty wynik tych prób pozwala potwierdzić poprawność wdrożenia. Stary serwis pozostaje nienaruszony. Prezentacja pod alternatywnym adresem powinna mieć `noindex`; roboty nie stanowią kontroli dostępu.
5. **Osobno uzgodnić migrację strefy, zachowując routing do obecnego GitHub Pages.** Dla domeny głównej `shadow-bridge.eu` Cloudflare Pages wymaga strefy Cloudflare oraz właściwych nameserverów. Najpierw ustalić obecne NS. Jeśli strefa jest poza Cloudflare, wyeksportować wszystkie rzeczywiste rekordy i sprawdzić DNSSEC/DS; przygotować identyczną strefę obejmującą A/AAAA/CNAME starej strony, MX, TXT, CAA oraz pozostałe usługi. Dla istniejącego routingu strony zachować DNS-only — na tym etapie nie włączać dodatkowego proxy ani nie kierować domeny do nowego Pages. Przedstawić oddzielny plan DNSSEC/DS, nie usuwać tych ustawień na ślepo. Dopiero po osobnej zgodzie właściciela na same NS wykonać migrację strefy i sprawdzić, że strefa jest aktywna, stare GitHub Pages nadal działa pod tą samą domeną przez HTTPS, a poczta oraz inne usługi zachowują działanie. **Podczas tego etapu i testowego podglądu nie zmieniać Custom domain/CNAME ani Enforce HTTPS w GitHub Pages.** Rejestrator pozostaje Porkbun. Dla samego `www` możliwy jest CNAME u obecnego operatora, po dodaniu tej subdomeny w panelu Pages; decyzję o apex/`www` trzeba oprzeć na obecnym stanie.
6. **Dopiero po aktywacji strefy przygotować i osobno zatwierdzić przełączenie witryny.** Połączyć docelowy projekt, domenę i certyfikat zgodnie z zaakceptowanym planem. Samo dodanie custom domain w panelu może automatycznie zmienić rekordy, więc nie wolno traktować go jako niezależnego, niewpływającego na ruch przygotowania. Przed zmianą routingu wymagane jest potwierdzenie gotowości właściwej domeny i nowego certyfikatu. Jeśli dostawca nie umożliwia takiej weryfikacji przed skierowaniem ruchu, zatrzymać przełączenie i przedstawić właścicielowi inny plan; nie obiecywać zerowej przerwy ani nie ryzykować HTTPS przez założenie natychmiastowej gotowości. Po oddzielnej zgodzie na konkretny routing i wdrożenie wgrać zaakceptowaną paczkę produkcyjną, wykonać uzgodnione przełączenie i zweryfikować apex oraz `www`, jedną wersję kanoniczną, przekierowanie HTTP→HTTPS, certyfikat, brak mixed content i kodów 404/5xx. Tymczasowe adresy dostawcy utrzymać jako `noindex`, niezależnie od indeksowalności docelowej domeny. Zachować poprzednią wersję GitHub Pages i pełny zapis poprzednich rekordów/NS do wycofania; przy błędach przywrócić uzgodnione rekordy starego hostingu, uwzględniając propagację. Nie usuwać starego serwisu ani przypisania domeny w GitHub Pages w ramach przygotowania. Wystawienie nowego certyfikatu i propagacja DNS nie były tu testowane.
7. Nie uruchamiać rejestracji ani paneli przy publikacji publicznej strony. Backend, konta użytkowników i uprawnienia pozostają osobnym, niezatwierdzonym etapem.

Direct Upload nie daje później prostego przełączenia tego samego projektu na integrację Git — dokumentacja wymaga wtedy utworzenia nowego projektu. Ręczna publikacja pozwala też uniknąć niezamierzonego wdrożenia przy zwykłym push gałęzi. Żaden powyższy krok wdrożeniowy nie został wykonany.

Projekt testowy powinien pozostać odrębny od docelowego projektu produkcyjnego. Po wgraniu indeksowalnego HTML do projektu produkcyjnego jego adresy techniczne `.pages.dev` również mogą otrzymać tę samą treść. Przed takim wgraniem należy zatwierdzić i sprawdzić regułę dostawcy, która dla technicznych hostname ustawia `X-Robots-Tag: noindex, nofollow` lub przekierowuje je na gotową domenę kanoniczną. Nie wystarczy wcześniejszy `noindex` paczki testowej. Dokładne hostname i reguły będzie można ustalić dopiero po wybraniu i utworzeniu zatwierdzonych projektów; nie skonfigurowano ich w tej fazie.

### Dokładny zakres późniejszych zgód

Po odbiorze wyglądu i funkcji strona pozostaje gotową paczką lokalną. Do osobnej, konkretnej akceptacji właściciela należy przedstawić:

1. **Podgląd internetowy:** wskazane konto i projekt, upload dokładnie przejrzanej paczki `build:preview` pod tymczasowy adres dostawcy, z `noindex` i bez własnej domeny. Jest to publikacja testowa, nie dotychczasowa zgoda na push Git.
2. **Docelowy hosting i koszty:** wybrany produkt/plan, konto właściciela, warunki komercyjne, limity i ewentualne rozliczenia. Brak zgody nie upoważnia do utworzenia płatnej usługi.
3. **Migracja strefy DNS, jeśli potrzebna:** dokładna kopia rekordów, stare/nowe NS i plan DNSSEC/DS, zachowanie routingu do starego GitHub Pages w trybie DNS-only oraz poczty i innych usług. Zmiana NS wymaga odrębnej zgody; po niej należy potwierdzić, że dotychczasowa strona nadal działa przez HTTPS. Rejestracja domeny pozostaje w Porkbun.
4. **Podłączenie domeny do nowego hostingu i przełączenie routingu:** dodanie apex/`www` w panelu wraz z ewentualnymi automatycznymi zmianami DNS, potwierdzona gotowość certyfikatu, dokładne stare/nowe rekordy, testy i plan wycofania. To osobna zgoda po aktywacji strefy, nie część zgody na migrację NS. Jeśli certyfikatu nie można sprawdzić przed zmianą ruchu, przełączenie pozostaje wstrzymane do uzgodnienia innego planu.
5. **Publikacja produkcyjna:** konkretny commit/paczka `build:production`, wskazany projekt, okno przełączenia i kontrole odbioru. Publikowany jest wyłącznie publiczny frontend oraz informacyjny `/cartel/`; nie rejestracja i nie stare panele.

Żaden z tych zakresów nie obejmuje merge do `main`, aktywacji kont lub budowy backendu. Jeśli kiedykolwiek merge okaże się potrzebny, będzie osobną decyzją z przeglądem zmian, ponieważ `main:/(root)` jest aktywnym źródłem obecnej strony.

Oficjalne źródła Cloudflare odczytane przez repozytorium dokumentacji `cloudflare/cloudflare-docs`:

- [Pages overview](https://developers.cloudflare.com/pages/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/index.mdx).
- [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/get-started/direct-upload.mdx).
- [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/configuration/custom-domains.mdx).
- [Headers](https://developers.cloudflare.com/pages/configuration/headers/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/configuration/headers.mdx).
- [Limits](https://developers.cloudflare.com/pages/platform/limits/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/platform/limits.mdx).

Źródła opisują możliwości produktu; nie stanowią potwierdzenia nowego wdrożenia ShadowBridge ani weryfikacji bieżących cen usług. Aktualne GitHub Pages, `main:/(root)`, domenę, udany DNS check i Enforce HTTPS potwierdził właściciel. Autorytatywna strefa DNS, stan `www`, rzeczywiste parametry certyfikatu oraz konfiguracja przyszłego hostingu pozostają do ustalenia przed migracją.
