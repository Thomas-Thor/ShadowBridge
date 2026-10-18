# ShadowBridge V2 — przygotowanie publikacji i ustalenia hostingu

Stan sprawdzenia: 18.10.2026. Dokument opisuje przygotowanie i przyszłą procedurę. **Nie wykonano publikacji, zmiany DNS, hostingu, źródła GitHub Pages, merge ani aktywacji rejestracji.** Prace pozostają na `feature/shadowbridge-v2`.

## Co zostało potwierdzone

| Ustalenie | Dowód i granica wniosku |
| --- | --- |
| Repozytorium to `Thomas-Thor/ShadowBridge`; domyślny zdalny ref to `main`. | Odczyt `git ls-remote --symref origin HEAD`. |
| Początkowy zdalny `main` wskazywał `6db80adf54a2793bb5c792c9829b2683dca8f2a3`, a zdalna gałąź V2 `d0ac38a6ed1fa10beca0533cc0777630a14b46ca`. | Odczyt `git ls-remote --heads origin main feature/shadowbridge-v2` przed bieżącymi poprawkami. To stan Git, nie dowód wdrożenia tych commitów. |
| Śledzony plik `CNAME` w katalogu głównym zawiera `shadow-bridge.eu`. | Lokalny plik oraz odczyt `https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/main/CNAME`. Deklaruje domenę w repozytorium; nie potwierdza aktualnego dostawcy ani aktywnej konfiguracji DNS/Pages. |
| Dotychczasowa gałąź `main` zawiera oba pliki `index.html` i `docs/index.html`; nie zawiera śledzonego workflow `.github/workflows`. | Odczyt drzewa `origin/main`. Samo drzewo nie rozstrzyga, który katalog jest publikowany; konfiguracja Pages jest przechowywana także poza repozytorium. |
| Obecny prototyp publiczny jest statycznym HTML/CSS/JS/SVG z lokalnymi fontami. | Przegląd struktury `v2/`. Publiczna prezentacja nie wymaga uruchamiania backendu, lecz nie zapewnia działających kont użytkowników ani wysyłki formularzy. |

## Czego nie można obecnie potwierdzić

Nie ustalono rzeczywistego dostawcy obsługującego domenę, aktywnej gałęzi i katalogu publikacji, produkcyjnego pliku wejściowego, przekierowania `www`, treści odpowiedzi serwera produkcyjnego ani ważności/wymuszenia HTTPS.

- `GET https://api.github.com/repos/Thomas-Thor/ShadowBridge/pages` zakończył się odmową proxy środowiska: `CONNECT tunnel failed, response 403`. Nie uzyskano odpowiedzi API GitHub i nie ustalono `build_type`, `source.branch`, `source.path`, `cname` ani `https_enforced`.
- Próby HTTP/HTTPS do `shadow-bridge.eu`, HTTPS do `www.shadow-bridge.eu` i adresu `thomas-thor.github.io/ShadowBridge/` również zatrzymał proxy. Nie są to dowody błędu 403 serwowanej witryny ani braku strony.
- Lokalny resolver zwracał `Temporary failure in name resolution`, również dla `thomas-thor.github.io`. Nie otrzymano rekordów DNS domeny; nie można na tej podstawie stwierdzić błędnej konfiguracji domeny.
- Nie uzyskano połączenia TLS z domeną, więc nie potwierdzono certyfikatu, nazwy hosta, dat ważności ani łańcucha zaufania. Nie wyłączano weryfikacji TLS.
- Publiczne widoki deployments zwracały 404. Nie dowodzi to, że wdrożenia nie istnieją lub że repozytorium nie korzysta z Pages.

Do zamknięcia tych ustaleń właściciel może przekazać **bez haseł i tokenów**:

1. Z `https://github.com/Thomas-Thor/ShadowBridge/settings/pages`: Source, branch/folder albo nazwę workflow, Custom domain, stan DNS check oraz Enforce HTTPS.
2. Nazwę obecnego dostawcy hostingu i dokładny katalog publikacji, jeśli strona działa poza GitHub Pages.
3. Z panelu DNS: rekordy NS oraz A/AAAA/CNAME dla `@` i `www`; przy planowanej migracji także informację o istniejącej poczcie i rekordach MX/TXT/CAA. Bez danych logowania.
4. Wynik otwarcia `https://shadow-bridge.eu` i `https://www.shadow-bridge.eu` w zwykłej przeglądarce: końcowy adres, komunikat HTTPS i widoczna wersja strony.

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

Rekomendacja techniczna dla statycznej witryny: **Cloudflare Pages, ręczny Direct Upload gotowej paczki**, po akceptacji dostawcy, warunków użycia, właściciela konta i ewentualnych kosztów. Oficjalna dokumentacja potwierdza obsługę statycznych plików, własnych domen, nagłówków i ręcznego wgrywania katalogu lub ZIP. Nie zakładano żadnego konta ani projektu. Nie zweryfikowano indywidualnej umowy lub planu konta właściciela; nie zaciągnięto zobowiązań finansowych. Alternatywą techniczną są Workers Static Assets; wybór produktu należy potwierdzić przy decyzji o publikacji, bez potrzeby zmiany statycznych plików V2.

Po zatwierdzeniu konkretnego wdrożenia:

1. Utrwalić zaakceptowany commit, wyniki testów i kopię obecnego wdrożenia wraz z konfiguracją. Potwierdzić obecnego dostawcę oraz drogę wycofania zmiany. Nie zakładać, że źródłem produkcji jest `main` lub `/docs`.
2. Zbudować paczkę powyższą komendą. Sprawdzić root `/`, `/cartel/`, wszystkie zasoby, linki, mobilne menu i kontakt, brak wywołań backendu i brak działającej rejestracji. Zatwierdzić finalny adres kanoniczny i treść SEO.
   Do osobnego wdrożenia testowego użyć zamiast produkcji `npm --prefix v2 run build:preview`: wynik `/workspace/exports/shadowbridge-v2-preview` zachowuje `noindex, nofollow` i blokadę robots. Nie wgrywać indeksowalnej paczki produkcyjnej pod tymczasowy adres.
3. Jeżeli właściciel zatwierdzi osobną publikację testową, w jego koncie Cloudflare wybrać **Workers & Pages → Create application → Get started → Drag and drop your files**, utworzyć odrębny projekt i wgrać sam katalog `/workspace/exports/shadowbridge-v2-preview` albo ZIP jego zawartości, z `index.html` w root. W tym wariancie build wykonuje się wcześniej lokalnie; ustawienia zdalnego buildu i automatyczne wdrażanie po push nie są potrzebne. Uruchomienie przycisku Deploy jest publikacją i nie jest obecnie autoryzowane. Zatwierdzoną paczkę produkcyjną stosuje się dopiero do uzgodnionego docelowego wdrożenia dla domeny produkcyjnej.
4. Sprawdzić wynik pod nadanym adresem `https://<nazwa-projektu>.pages.dev`: HTTP, TLS, nagłówki, wszystkie zasoby, przekierowania i oba widoki responsywne. Dopiero rzeczywisty wynik tych prób pozwala potwierdzić poprawność wdrożenia. Stary serwis pozostaje nienaruszony. Prezentacja pod alternatywnym adresem powinna mieć `noindex`; roboty nie stanowią kontroli dostępu.
5. **Osobno uzgodnić** podłączenie istniejącej domeny. Nie dodawać jej samodzielnie do projektu ani nie zmieniać DNS. Dla domeny głównej `shadow-bridge.eu` Cloudflare Pages wymaga strefy Cloudflare oraz właściwych nameserverów. Jeżeli domena jest dziś poza Cloudflare, to dodatkowa migracja DNS, obejmująca zachowanie poczty i wszystkich rekordów. Dla samego `www` możliwy jest CNAME u obecnego operatora, po dodaniu tej subdomeny w panelu Pages. Nie podejmować decyzji o apex/`www` bez poznania obecnego stanu.
6. Po odrębnej zgodzie na zmianę produkcji i domeny wykonać uzgodnione przełączenie. Zweryfikować apex i `www`, jedną wersję kanoniczną, przekierowanie HTTP→HTTPS, certyfikat, brak mixed content i kodów 404/5xx. Zachować poprzednią wersję oraz zapis poprzednich rekordów do wycofania. Wystawienie nowego certyfikatu i propagacja DNS nie były tu testowane.
7. Nie uruchamiać rejestracji ani paneli przy publikacji publicznej strony. Backend, konta użytkowników i uprawnienia pozostają osobnym, niezatwierdzonym etapem.

Direct Upload nie daje później prostego przełączenia tego samego projektu na integrację Git — dokumentacja wymaga wtedy utworzenia nowego projektu. Ręczna publikacja pozwala też uniknąć niezamierzonego wdrożenia przy zwykłym push gałęzi. Żaden powyższy krok wdrożeniowy nie został wykonany.

Oficjalne źródła Cloudflare odczytane przez repozytorium dokumentacji `cloudflare/cloudflare-docs`:

- [Pages overview](https://developers.cloudflare.com/pages/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/index.mdx).
- [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/get-started/direct-upload.mdx).
- [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/configuration/custom-domains.mdx).
- [Headers](https://developers.cloudflare.com/pages/configuration/headers/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/configuration/headers.mdx).
- [Limits](https://developers.cloudflare.com/pages/platform/limits/) — [źródło](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/pages/platform/limits.mdx).

Źródła opisują możliwości produktu; nie stanowią potwierdzenia wdrożenia ShadowBridge ani weryfikacji bieżących cen usług. Domena, DNS, certyfikat i źródło aktualnej publikacji pozostają do potwierdzenia przez właściciela lub dostępny odczyt panelu.
