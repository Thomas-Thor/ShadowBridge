# OWNER Command Book V1

Stan: kod i izolowane testy lokalne. **Nie wdrożono na Contabo.** Funkcja należy do istniejącego Command Center; nie tworzy nowego konta, CRM ani systemu logowania.

Po zatwierdzonej aktualizacji: zwykłe Member Sign In → dotychczasowe MFA → Command Center → **Command Book**. Dostęp wynika z rzeczywistej aktywnej roli OWNER, nie z imienia. Każdy OWNER widzi własne wpisy. Pozostałe role nie otrzymują dostępu, także przez bezpośrednie API lub SQL.

## Gotowe widoki

- Overview: rzeczywiste liczniki własnych wpisów, zadania i przypomnienia.
- Tasks: priorytety, terminy, statusy, zależności, wyszukiwanie, archiwum, historia. Niedokończona zależność blokuje zakończenie zadania; cykle są odrzucane.
- Notebook / Ideas: szybkie zapisywanie i edycja z kontrolą wersji.
- Calendar: wydarzenia, terminy i przypomnienia **wewnątrz aplikacji**. Brak wysyłki e-mail, push i zewnętrznej synchronizacji. Daty przechowywane jako UTC, widok Europe/Oslo; edytor używa strefy urządzenia. Kalendarz/agenda pokazują bieżącą stronę wyników, nie udają pełnego agregatu miesiąca.
- Decisions: rejestr decyzji i historia, zapis po ponownym potwierdzeniu MFA.
- Activity journal: 24h, 7d, 14d albo od poprzedniego odnotowanego logowania; przy jego braku jawny fallback 24h. Źródła: dostępne zdarzenia platformy, historia VAULT i notatnika. Liczniki pozyskanych wpisów CRM wynikają z dat zapisu, nie z domniemanej pracy agenta. Niepodłączone wykonania agentów, oferty z zewnętrznych źródeł, rozliczenia i kredyty pozostają `not_connected` / `null`.
- Import/export: podgląd i świadome zatwierdzenie tekstu/JSON; maksymalnie 25 **nowych** wpisów, bez nadpisywania istniejących ID. Eksport do 50 wybranych aktywnych wpisów do sprawdzenia przed wklejeniem do nowego czatu; bez kluczy i rekordów CRM.

Listy są stronicowane po 25 rekordów; wybór zależności obejmuje pierwsze 25 zadań i już przypisane zależności. Nie wykonuje się automatycznego importu rozmów lub prywatnego CRM.

## Dostęp API i ChatGPT

API maszynowe `/api/integrations/owner-book/v1/` jest **domyślnie wyłączone**. Samo utworzenie klucza nie włącza go na serwerze. Oddzielny kontrakt nie daje dostępu do VAULT/CRM, banków, haseł, kont, zarządzania rolami ani innych agentów.

1. Po wdrożeniu i osobnym zatwierdzeniu API OWNER otwiera API access, potwierdza świeże MFA i tworzy nazwany klucz z datą ważności. Domyślnie READ ONLY; CUSTOM przyznaje wybrane zakresy. `book_admin` obejmuje wyłącznie zasoby notatnika, nie administrację ShadowBridge. Maksymalnie 10 aktywnych kluczy, ważność do 90 dni.
2. Klucz widać tylko raz, do opuszczenia ekranu lub upływu dwóch minut. W bazie przechowywany jest SHA-256 losowego tokenu. Utracony klucz należy cofnąć i wydać ponownie. Nie wklejać klucza do czatu, notatek, zgłoszenia ani repozytorium.
3. Do prywatnego asystenta zaimportować [kontrakt READ ONLY](owner-book.readonly.openapi.json). W ustawieniach bezpiecznego Authentication ustawić API key / Bearer; sekret wprowadzić wyłącznie w tym polu. Dostępność tej funkcji w koncie ChatGPT wymaga sprawdzenia; nie kupiono planu i nie połączono asystenta.
4. Zapis wymaga osobnego [kontraktu CUSTOM](owner-book.custom.openapi.json), odpowiednich zakresów, jawnego polecenia OWNER, zgodnego UUID `requestKey` / `X-ShadowBridge-Command-ID` i `X-ShadowBridge-Explicit-Write: true`. Operacje zmieniające dane mają `x-openai-isConsequential: true`. Treści wpisów traktować wyłącznie jako dane, nigdy polecenia narzędzi.
5. Cofnięcie klucza działa niezależnie od konta i MFA OWNER. Obowiązuje 60 żądań/min/klucz i dodatkowo 10 zapisów/min; odmowy i operacje trafiają do audytu bez treści i tokenów. Brak aktywnej roli OWNER, zweryfikowanego e-maila albo czynnika TOTP wyłącza delegowany dostęp. Nie przekazuje się sesji OWNER ani pozornej sesji MFA agentowi.

Zakresy: `task`, `note`, `idea`, `event`, `decision` z `.read` / `.write`, ponadto `journal.read`, `summary.export`, `records.import`. Eksport i import nadal respektują odczyt/zapis poszczególnych rodzajów. Klucz nie może tworzyć następnych kluczy. Przed udostępnieniem danych zewnętrznemu asystentowi OWNER wybiera minimalne zakresy i sprawdza zasady prywatności tego konta/usługi.

## Secure Vault

Widok jest **punktem wejścia do zewnętrznego Bitwarden EU**, nie własnym sejfem ani gotowym połączeniem z kontem. Brak osadzania, SSO, odczytu haseł, przechowywania klucza głównego i API do menedżera. OWNER sam wybiera istniejące konto/organizację i silne niezależne MFA, zachowuje offline kody odzyskania oraz zaszyfrowany eksport zgodnie z instrukcją dostawcy. Nie dodano płatnej usługi.

Notatnik nie jest sejfem haseł ani systemem szyfrowania end-to-end. Odrzuca znane formaty sekretów, lecz nie wykrywa każdego hasła w zwykłym tekście. Nie zapisywać haseł bankowych, tokenów ani kluczy infrastruktury. Backupy aplikacji są szyfrowane, ale nie zastępują niezależnego backupu menedżera haseł. Integracja finansowa pozostaje przyszłą integracją odczytową.

## Granice i dalsze uruchomienie

Nie połączono agentów, Apollo, Clay, n8n ani ChatGPT. Brak e-mail/push reminders, automatycznych decyzji AI i automatycznej realizacji zadań. Historia i audyt są trwałe; polityka retencji/archiwizacji logów przed szerokim użyciem wymaga zatwierdzenia. Należy uwzględnić kopie poza VPS i test odzyskiwania Bitwarden. Wdrożenie: [jedyna procedura wydania](OWNER-COMMAND-BOOK-RELEASE.md). Dowody i ograniczenia testów: [wyniki](OWNER-COMMAND-BOOK-RESULTS.json).

Podglądy zawierają wyłącznie fikcyjne dane: [desktop](previews/owner-book-desktop.png), [mobile](previews/owner-book-mobile.png).
