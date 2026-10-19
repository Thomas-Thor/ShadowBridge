# C.A.R.T.E.L. Private Network — architektura

Status: **projekt przyszłej funkcji**. Obecnie działa wyłącznie dyskretny link do istniejącej strony `/cartel/`. Nie uruchomiono zaproszeń, rejestracji członkowskiej ani prywatnych przestrzeni. Konta Buyer, Supplier i Partner nie mają ścieżki automatycznego rozszerzenia do C.A.R.T.E.L.

## Oddzielna władza i dostęp

- OWNER określa politykę przyjmowania i najwyższe uprawnienia sieci; tylko OWNER może zmienić tę politykę lub nadać prawo zatwierdzania członków. Wymagane świeże MFA i audyt. Dyrektor ani manager nie może sam nadać sobie tych praw.
- Uprawnienia członkowskie C.A.R.T.E.L. są niezależne od pracowniczego RBAC ShadowBridge. Zaproszenie i członkostwo nie nadają dostępu do Command Center, CRM, bazy firm, ofert źródłowych ani danych kontrahentów. Nadanie jednej roli nigdy nie tworzy drugiej.
- Prywatne przestrzenie mają osobne przydziały do konkretnego projektu i dokumentu. Domyślna odmowa w API i RLS; przeglądarka otrzymuje wyłącznie zatwierdzony zakres danych. Lista członków również pozostaje prywatna.

## Planowane rekordy i proces

| Rekord | Minimalny zakres i reguła |
|---|---|
| `cartel_invitations` | Odbiorca wewnętrzny, hash jednorazowego tokenu, nadawca, termin; `draft → issued → accepted / expired / revoked`. Akceptacja wymaga potwierdzenia tego samego e-maila i nie aktywuje członkostwa. |
| `cartel_memberships` | Użytkownik, `pending_review → active / rejected / suspended / revoked`, zatwierdzający, zakres i okres obowiązywania. Decyzja w osobnym zatwierdzonym procesie. |
| `cartel_spaces`, `cartel_space_grants` | Projekt/przestrzeń, imienny odbiorca, precyzyjne prawa, termin i cofnięcie; bez domyślnego dostępu dla wszystkich członków. |
| `cartel_membership_events` | Zaproszenie, decyzja, zmiana i cofnięcie; aktor, czas, powód, wersja polityki. Bez sekretów i pełnych tokenów. |

Wszystkie zmiany przechodzą przez autoryzowane API i transakcje bazy, z ochroną przed wyścigiem cofnięcia i akceptacji. Cofnięcie członkostwa blokuje kolejne odczyty, unieważnia zaproszenia i przydziały sieci; nie zmienia niezależnej roli pracowniczej. Zawieszenie konta blokuje obie ścieżki. Dostępu do wcześniej pobranego pliku nie można fizycznie odebrać.

Przed implementacją: decyzja OWNER o kryteriach członkostwa, osobie zatwierdzającej, okresie ważności, retencji i umowach poufności. Następnie testy bezpośrednich wywołań API, RLS, MFA, obcych przestrzeni, wygasłych/cofniętych zaproszeń oraz prób uzyskania uprawnień administracyjnych przez członka. Bez publikacji lub płatnych usług w obecnym etapie.
