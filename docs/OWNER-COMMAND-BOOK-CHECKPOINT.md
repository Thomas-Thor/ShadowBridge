# OWNER Command Book V1: checkpoint

24.10.2026. Gałąź `feature/owner-command-book-v1`, baza International R1 `cf5ae88`. Integracja pozyskiwania kontaktów `d3e1007` jest zachowana osobno i nie została tu połączona.

Gotowe w kodzie: transakcyjna migracja 018, prywatne rekordy z zależnościami i historią, kalendarz/przypomnienia w aplikacji, dziennik z rzeczywistych tabel, import/eksport, klucze zakresowe i odwoływanie, odrębne API maszynowe domyślnie wyłączone. Nie zmieniono istniejącego konta, hasła, MFA ani rekordu CRM.

Rzeczywisty test PostgreSQL: **10/10 grup PASS**, fikcyjny klon `owner_book_test_0879e9a4`, odtworzenie zaszyfrowanego pełnego backupu do `owner_book_restore_0879e9a4`. Wyniki prywatne: `.local/owner-book-0879e9a4/results.json`. Test badał SQL/RLS/uprawnienia z jawnymi testowymi claims i czynnikami MFA, **nie logowanie do rzeczywistego GoTrue ani Contabo**. Konta, sesje, MFA, role i CRM sprzed migracji zachowane; izolacja dwóch fikcyjnych OWNER i odmowa pozostałych ról potwierdzone. Testy źródeł migracji, konfiguracji i walidacji istniejącego VAULT: **20/20 PASS**.

Do wykonania: pełny interfejs w Command Center, OpenAPI i instrukcja bezpiecznego połączenia ChatGPT, celowane HTTP/UI, integracja odtwarzania roli nowego executor, plan aktualizacji/rollbacku i raport końcowy. Ciężkie pliki znajdują się na osobnym `/tmp`, z kontrolą miejsca; nie usuwać testowych baz/backupów.

Contabo: brak SSH i aktualnego odczytowego raportu stanu. Rzeczywisty OWNER + MFA, aktywne obrazy, profil gateway i backup na tym serwerze pozostają niepotwierdzone. Nie wykonywać aktualizacji ani zmiany DNS. Przed publikacją nadal wymagane są odczytowa diagnostyka, interaktywne potwierdzenie logowania OWNER oraz osobna zgoda.

Płatne operacje, banki, nowy menedżer haseł, automatyzacje i agentowe importy nie zostały uruchomione. Sejf haseł ma być zewnętrznym sprawdzonym menedżerem, a nie tabelą notatnika.
