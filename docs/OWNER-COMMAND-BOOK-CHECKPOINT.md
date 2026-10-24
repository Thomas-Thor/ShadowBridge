# OWNER Command Book V1: checkpoint

24.10.2026. Gałąź `feature/owner-command-book-v1`, baza International R1 `cf5ae88`. Integracja pozyskiwania kontaktów `d3e1007` jest zachowana osobno i nie została tu połączona.

Gotowe w kodzie: transakcyjna migracja 018, prywatne rekordy z zależnościami i historią, kalendarz/przypomnienia w aplikacji, dziennik z rzeczywistych tabel, import/eksport, klucze zakresowe i odwoływanie, odrębne API maszynowe domyślnie wyłączone. Nie zmieniono istniejącego konta, hasła, MFA ani rekordu CRM.

Aktualne wyniki: PostgreSQL **10/10 grup PASS** (`.local/owner-book-2db3cf7b/results.json`), Chromium desktop/mobile + rzeczywiste API notatnika/PostgreSQL **7/7** (`.local/owner-book-ui-3cc8cde2/results.json`), odtworzenie pełnego zaszyfrowanego backupu w nowym PostgreSQL i smoke poprzedniego obrazu R1 na klonie z 018 **3/3** (`.local/owner-book-recovery-52664b91/results.json`). Odtworzono 79 tabel. Konta, sesje, MFA, role i CRM sprzed migracji zachowane; izolacja dwóch fikcyjnych OWNER i odmowa pozostałych ról potwierdzone. Testy jednostkowe i zabezpieczeń: **37 różnych przypadków PASS**.

Testy używały wyłącznie fikcyjnych kont. SQL otrzymywał jawne testowe claims/MFA; przeglądarka korzystała z testowych endpointów sesji. **Nie są to testy interaktywnego logowania GoTrue ani Contabo.** Migracja 018 pozostaje niewdrożona na rzeczywistym serwerze. Przywrócenie konfiguracji do nowego środowiska wymusza wyłączenie API maszynowego, aby starszy backup nie przywrócił dostępu cofniętych kluczy.

Gotowe również: interfejs w Command Center, oddzielne kontrakty OpenAPI READ ONLY / CUSTOM, testy UI, odzyskiwanie roli executor, kontrolowany plan aktualizacji wyłącznie aplikacji i opcjonalny przełącznik API. Do zakończenia: budowanie aktualnych obrazów, natywny smoke kontenera, końcowa instrukcja aktualizacji i raport. Ciężkie pliki znajdują się na osobnym `/tmp`, z kontrolą miejsca; nie usuwać testowych baz/backupów.

Contabo: brak SSH i aktualnego odczytowego raportu stanu. Rzeczywisty OWNER + MFA, aktywne obrazy, profil gateway i backup na tym serwerze pozostają niepotwierdzone. Nie wykonywać aktualizacji ani zmiany DNS. Przed publikacją nadal wymagane są odczytowa diagnostyka, interaktywne potwierdzenie logowania OWNER oraz osobna zgoda.

Płatne operacje, banki, nowy menedżer haseł, automatyzacje i agentowe importy nie zostały uruchomione. Sejf haseł ma być zewnętrznym sprawdzonym menedżerem, a nie tabelą notatnika.
