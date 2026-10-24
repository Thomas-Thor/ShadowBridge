# Wydanie OWNER Command Book: jedna ścieżka aktualizacji

**Aktualizacja:** Book został już połączony z gałęzią R1. Aktualny przebieg to
[jeden installer operatora](PRODUCTION-R1-OWNER-RUN.md). Poniższy zapis jest
historycznym przygotowaniem z poprzedniego checkpointu, nie dodatkową procedurą.

**READY FOR PREFLIGHT, nie zgoda na wdrożenie.** Brak SSH do Contabo. Odczyty publicznych `/health` i `/api/config` zostały zablokowane przez proxy CONNECT 403, również po ponowieniu poza sandboxem; to nie jest dowód awarii strony. Nie znamy faktycznych kontenerów, wersji i stanu OWNER na serwerze. Nie zmieniono Contabo, DNS, kont ani produkcyjnych danych.

## Teraz: tylko odczytowy raport

Jedynym wymaganym obecnie działaniem operatora jest krok **0** z [procedury International R1](INTERNATIONAL-R1-DEPLOYMENT.md): niezależny, sprawdzany sumą skrypt diagnozy zastanej instalacji. Pobrać i uruchomić go jako `shadowadmin` na Contabo; przekazać wyłącznie jego pozbawiony sekretów raport JSON. Nie przełączać checkoutu przed odczytem. Jeśli można udostępnić zatwierdzony kanał odczytowy, diagnostykę może wykonać uprawniony operator zamiast OWNER. Nie przekazywać SSH/API kluczy w czacie.

Diagnoza dotyczy **historycznej bazy R1 001–017**. To celowe: nie potwierdza migracji 018. Obecny instalator dopuszcza wyłącznie rozpoznany aktywny profil no-mail `7f794a2` z fingerprintowanym gatewayem n8n `9a64cc0`. Sam SHA checkoutu nie wystarcza. Prywatny staging, oddzielny publiczny Caddy, ręczna konfiguracja lub inna aktywna wersja oznaczają STOP i przygotowanie osobnego etapu zgodności z rzeczywistego raportu. Nie tworzyć zastępczych manifestów, nie zmieniać sekretów i nie obchodzić guardów.

OWNER musi następnie osobiście potwierdzić dotychczasowe logowanie i TOTP w działającej instalacji. Licznik poprawnie skonfigurowanych OWNER nie dowodzi tożsamości Vincenta ani posiadania jego authenticatora. Nie zmieniamy jego konta. Odzyskanie samego hasła, jeśli konieczne, jest odrębną procedurą [owner-recovery.md](owner-recovery.md), z osobną zgodą, potwierdzeniem tożsamości i zachowaniem MFA. Nie jest częścią aktualizacji.

## Po raporcie, pozytywnym sprawdzeniu i osobnej zgodzie OWNER

Ta sekwencja uzupełnia kroki 1–6 procedury R1; nie uruchamiać jej teraz:

1. Zintegrować zatwierdzony SHA `feature/owner-command-book-v1` z **release/shadowbridge-international-r1**, bez zmiany `main`. Aktualny feature zawiera bazę R1 `cf5ae88`; nie zawiera niewdrożonej integracji pozyskiwania danych. Wskazać pełny końcowy SHA wydania. Narzędzie `prepare` wymaga czystej gałęzi R1, zgodnej etykiety OCI i niezmiennego ID obrazu. Te zabezpieczenia pozostają aktywne.
2. Wykonać odczytowy preflight, potwierdzić miejsce na nowe obrazy i zaszyfrowane kopie. Zbudować runtime i migrator z dokładnie tego SHA, zachować poprzednie obrazy. Użyć istniejącego `international-r1.mjs prepare/check`; nie pełnego `production:deploy`, nie `staging:ops update` i nie `npm run demo`.
3. **Domyślnie pozostawić zdalne API wyłączone.** Tylko jeśli zatwierdzone okno obejmuje API, do jedynego wywołania `prepare` w kroku 2 instrukcji R1 dodać `--book-api=enabled`; w przeciwnym razie `--book-api=disabled`. Przełącznik zmienia wyłącznie env nowego kontenera app w planie chronionym kontrolą fingerprintów; nie przepisuje `app.env`, haseł, Auth ani gatewaya. Nie edytować JSON planu ręcznie. Rollback zachowuje poprzednią wartość.
4. Zatrzymać app/Auth; wykonać istniejące zaszyfrowane kopie bazy, prywatnej konfiguracji oraz danych/certyfikatów Caddy, snapshot danych i kopię poza VPS z oddzielnym kluczem. Błąd kopii oznacza brak migracji i wznowienie poprzednich kontenerów. Nie usuwać wolumenów, obrazów lub nieudanych kopii.
5. Migrator sprawdza **001–018** i stosuje wyłącznie brakujące migracje. Historia 001–017 pozostaje bajtowo niezmieniona. 018 tworzy schemat `owner_book` i ograniczoną rolę NOLOGIN, nie modyfikuje kont, haseł, sesji, MFA ani wpisów CRM. W izolowanym teście nazwa executor została zastąpiona unikalną nazwą testową, aby uniknąć kolizji we współdzielonym fikcyjnym klastrze; produkcyjny SQL używa jednej nazwy docelowej. Inny zapisany checksum 018 lub nieznana historia: **STOP**, nie nadpisywać SQL/ledger ani nie ponawiać na ślepo.
6. `preserved` porównuje wszystkie wcześniejsze dane, w tym `owner_book`, jeśli już istniał. Po sukcesie wznowić Auth i zastosować wyłącznie aplikację przygotowanym skryptem. Caddy/n8n, sieci, certyfikaty i wolumeny pozostają zgodne z pierwotnym profilem. Nie wykonywać całego `compose up`.
7. `verify` sprawdza R1/HTTPS/Auth i n8n. Dodatkowo istniejący OWNER sprawdza MFA, wejście do Book, zapis/edycję fikcyjnego zadania, historię, kalendarz, import/eksport i odmowę innej roli. Jeśli API zatwierdzono: utworzyć świeżym MFA krótkotrwały klucz READ ONLY, sprawdzić odczyt, odmowę zapisu i cofnięcie, potem usunąć sekret z klienta. Nie używać rzeczywistych poufnych wpisów do prób integracji.

Zatrzymanie: przed migracją poprzednia aplikacja pozostaje źródłem działania; w oknie kopii wznowić zachowane kontenery zgodnie z R1. Nie podejmować zmian po nieudanym guardzie. Publiczna rejestracja/reset e-mail pozostają wyłączone w profilu no-mail; nowy notatnik nie uruchamia ich i nie rozwiązuje braku SMTP.

## Rollback i awaria

Rollback stosuje wyłącznie zachowany poprzedni ID obrazu i poprzedni przełącznik API przez `rollback-application.sh --application-only-no-database-restore`. **Nie cofać migracji, nie odtwarzać backupu na źródło, nie usuwać nowych wpisów.** Stara aplikacja nie pokazuje Book, ale dane zostają w bazie. Taki start starego R1 na klonie bazy po 018 został wykonany: `/health` i `/api/config` działają, dane Book pozostają. Nie wykonano ponownego interaktywnego logowania GoTrue w starym runtime.

Odtwarzanie po awarii: wyłącznie do nowego pustego celu, istniejącym `staging:ops restore`. Nowy hostowy helper tworzy wymaganą rolę Book tylko na pustym celu, bez loginu/DBA/BYPASSRLS. Pełny zaszyfrowany backup odtworzono w osobnym PostgreSQL: 79 tabel i ACL/RLS zgodne. Odtworzona konfiguracja **wymusza `OWNER_BOOK_API_ENABLED=false`**; starsza kopia może zawierać klucze cofnięte później. Przed ponownym udostępnieniem API OWNER musi cofnąć odzyskane stare klucze i wydać nowe po świeżym MFA. Nie oznaczać starego klucza jako bezpiecznego na podstawie samego odtworzenia. Oryginalna instalacja i jej konfiguracja nie są nadpisywane.

## Apollo, Clay, n8n: dokładnie co pozostało

Oddzielna gałąź [feature/nightly-global-acquisition](https://github.com/Thomas-Thor/ShadowBridge/tree/feature/nightly-global-acquisition), checkpoint `d3e1007`, ma nieaktywne workflow, instalator autoryzacji oraz przetestowaną bramkę deduplikacji/kosztów. **Nie połączono jej z tym wydaniem i nie jest uruchomioną automatyzacją.**

Po zakończeniu publikacji, w osobnym zatwierdzonym etapie:

1. OWNER jednorazowo udziela praw API istniejącego n8n oraz odczytu Apollo/Clay, jeżeli opłacone plany je udostępniają. [INTEGRATION-AUTH.md](https://github.com/Thomas-Thor/ShadowBridge/blob/feature/nightly-global-acquisition/automation/nightly-global/INTEGRATION-AUTH.md) zawiera jeden instalator z ukrytym wejściem kluczy i kontrolą sumy. Importuje wyłącznie nieaktywne przepływy. Brak obsługiwanego API oznacza pominięcie źródła, bez zakupów.
2. Automat/operator odczytuje rzeczywiste zakresy, limity, salda, koszty i formaty źródeł; dziś są niepotwierdzone. Wymagany autoryzowany kanał dostępu do instancji. Sam zapis credentials nie łączy tej sesji Codexa z serwerem.
3. Osobno zatwierdzić zastosowanie kandydata CRM guard i wąskiego API maszynowego do istniejącego VAULT, bez sesji OWNER/DBA. Wpiąć regionalne przepływy w trwałą pamięć wyszukiwań, deduplikację oraz raport 08:00. Obecne bazowe workflow nie są jeszcze do niej podłączone.
4. Przetestować nieaktywne przepływy na fikcyjnych rekordach w istniejącym n8n. Osobno zatwierdzić harmonogramy i ewentualne płatne adaptery z limitami. Nie zmieniać czterech Scoutów ani kupować kredytów. Nie zadeklarowano 1000 prawdziwych rekordów/noc.

Nie wymaga się teraz wielogodzinnej konfiguracji ani wykonywania wszystkich tych kroków przez OWNER. Obecnie potrzebny jest wyłącznie odczytowy raport Contabo; aktywacje pozostają osobnymi decyzjami.
