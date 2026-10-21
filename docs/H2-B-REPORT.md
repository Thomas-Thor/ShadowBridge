# H2-B — spójna nawigacja Command Center

Jedna definicja menu i wspólny komponent nawigacji obsługują teraz zarówno moduły
`/portal/admin/`, jak i osobny `/portal/offers/`. Offers zachowuje pełne menu
dozwolonych modułów, oznaczenie aktywnej pozycji i powrót do Command Center.
Widoczność wynika z efektywnych uprawnień zwróconych przez backend po MFA.
Autoryzacja API/RLS, sesje, CSRF i MFA nie zostały zmienione.

Na telefonie zachowano istniejące menu przewijane poziomo i cele dotykowe co
najmniej 44 px. Wylogowanie lub zmiana konta usuwa prywatne linki, rekordy i dane
konta także w otwartym Offers. Błąd uruchomienia również czyści menu.

## Wykonane testy

- **3/3 testy prezentacji PASS**: responsywność, klawiatura i axe; brak dostępu
  przy niedostępnym backendzie/pending/MFA; czyszczenie menu po zmianie sesji.
  Te testy używają fikcyjnych DTO i nie dowodzą działania backendu.
- Oddzielna instalacja PostgreSQL + GoTrue + API + Caddy/TLS, rzeczywisty
  Chromium, bez mocków i zewnętrznych e-maili: **6 zakończonych grup PASS**.
  Potwierdzony fikcyjny OWNER otrzymał uprawnienie przez istniejący CLI, zalogował
  się i skonfigurował prawdziwe TOTP. Przed MFA Offers odmawia dostępu.
- Wykonano **12 przejść** Overview→Offers→Buyer requests→Companies→Overview,
  na 1440/390/320 px. Menu ma te same 14 pozycji OWNER i dokładnie jedną aktywną;
  identyfikator sesji i AAL2 pozostają zachowane. Brak overflow strony.
- Wylogowanie w trzeciej karcie faktycznie wyczyściło menu/rekordy obu pozostałych
  kart, `/api/session` zwróciło `null`, a prywatne API zwróciło 401.

Pierwsze wykonanie zatrzymało się na **błędnym ostatnim oczekiwaniu testu**:
anonimowy `/portal/offers/` przekierowuje do Member Sign In, więc nie zawiera
`#offers-status`. Nie był to błąd aplikacji. Oczekiwanie poprawiono; ten końcowy
przypadek sprawdzono osobno, bez powtarzania zaliczonych 12 przejść i MFA.

Powtarzalny test: `tests/h2-navigation.integration.mjs`, wyłącznie z jawnym
katalogiem nowego, izolowanego fixture H1/H2. Wyniki lokalne:
`/tmp/shadowbridge-h2-navigation-regression.json` zachowuje błąd oczekiwania;
`/tmp/shadowbridge-h2-navigation-anonymous.json` zawiera osobny końcowy PASS.
Nie wykonano ponownego pełnego run 7/7. Fixture zatrzymano bez usuwania
kontenerów/wolumenów. Nie wykonywano wdrożenia na
Contabo ani pełnej regresji wszystkich modułów biznesowych.

Późniejsza aktualizacja z kopią i zasadami wycofania:
[H2-STAGING-UPDATE.md](H2-STAGING-UPDATE.md).
