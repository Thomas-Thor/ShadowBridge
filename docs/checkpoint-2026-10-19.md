# Zabezpieczenie pracy — 19 października 2026

Gałąź: `feature/secure-b2b-mvp`. Baza: `a4582db`. Ten zapis zachowuje zastane
zmiany po przerwaniu środowiska; nie oznacza ukończenia ani zgody na publikację.
Decyzja właściciela: po zapisaniu punktu kontrolnego zatrzymać pracę.

## Zachowane zmiany

- RBAC siedmiu stanowisk, indywidualne uprawnienia, RLS, audyt, ochrona OWNER,
  świeże MFA dla krytycznych operacji i kontrola limitów prowizji.
- Osobny Overview i moduły zarządu; Offers Workspace z kartami, paginacją,
  wyszukiwaniem, klasyfikacją, kwalifikacją dostawcy oraz historią decyzji.
- Osiem kategorii i 24 podkategorie; EUR, USD, GBP, NOK, PLN. Niepewne stare
  klasyfikacje zachowane do ręcznego przeglądu, bez kasowania rekordów.
- Członkostwo wielu użytkowników w firmie, izolacja danych, poprawki sesji/CSRF
  i wylogowania w wielu kartach; kontrolowana procedura odzyskiwania OWNER.
- Dyskretny Horus, komunikat poufności oraz dokumenty architektury C.A.R.T.E.L.
  i materiałów ofert. Szkic stagingu zachowany i oznaczony jako niekompletny.

## Sprawdzone podczas zabezpieczenia

| Kontrola | Wynik |
|---|---|
| Rzeczywiste API / PostgreSQL / GoTrue / Mailpit | 14/14 testów Node, w tym 13 scenariuszy procesu B2B |
| Konfiguracja, polityka poczty, walidacja | 6/6 |
| Składnia zmienionych i nowych plików JS/MJS/CJS | 31 plików — poprawna |
| Zgodność źródeł migracji z ledgerem bazy | wszystkie 10 zgodne |
| `git diff --check` | poprawny |

Test API uruchomiono po ponownym starcie rzeczywistego lokalnego BFF; obejmuje
rejestrację, potwierdzenia w Mailpit, MFA, akceptację firm, oferty/RFQ,
indywidualne anonimowe udostępnienia, izolację firm, reset hasła i zawieszenie.
Nie wysyłano wiadomości do rzeczywistych odbiorców.

Wcześniej w tym zadaniu uzyskano także wyniki: RBAC API 8 scenariuszy, sesje API
5 scenariuszy, sesje/Overview/Team w przeglądarce 6/6, workspace w przeglądarce
2/2 (25 ofert), testy SQL/RLS dla RBAC/workspace/taksonomii oraz migrację sześciu
rekordów legacy w osobnej tymczasowej bazie. Test RBAC SQL objął 27 pozytywnych
asercji i 34 próby niedozwolonych działań. Statyczne stopki przeszły 18 kombinacji
stron i szerokości. To wyniki wcześniejszych wykonań w tym zadaniu, nie ponowienie
całej macierzy po ostatnim przywróceniu środowiska. Statyczne sprawdzenia nie są
testami działającego uwierzytelniania.

## Niedokończone i niewłączone

1. Końcowa próba nowego `npm run demo`, ponownego startu i aktualizacji istniejącej
   instalacji użytkownika. Zachowane konta, hasła i wolumeny nie są resetowane.
2. Ponowienie całej odpowiedniej macierzy mobilnej/desktopowej i kontaktowej po
   ostatnich zmianach. Nie oznaczono tych pakietów jako ponownie zaliczone.
3. Staging: brak generatora konfiguracji/certyfikatów, `staging:prepare` i
   `scripts/staging-migrate.mjs`; zachowany Dockerfile odwołuje się do brakującego
   skryptu. Internetowego wdrożenia nie wykonano ani nie przetestowano.
4. Upload, prywatny storage, skanowanie/oczyszczanie plików i rzeczywiste galerie.
   Obecne pola zdjęć i dokumentów są jawnymi placeholderami.
5. Właściwy prywatny portal i mechanizm zaproszeń C.A.R.T.E.L. — architektura,
   bez aktywacji. Istniejąca strona `/cartel/` pozostaje bez zmian.
6. Dowolny wybór managera oferty: obecnie działa przypisanie do siebie i zdjęcie
   przypisania. Szczegółowy RBAC pracowników kontrahenta i zaproszenia do firmy
   nie są osobnym ukończonym systemem; istnieje członkostwo Buyer/Supplier/Partner.
7. Odrębny silnik transakcji, logistyki i zadań oraz internetowy test procedury
   odzyskania OWNER. Opisana procedura awaryjna wymaga operatora infrastruktury.
8. Zewnętrzny SMTP, monitoring, kopie poza serwerem i próba odtworzenia pełnego
   wdrożenia — nieuruchomione. Nie zatwierdzono płatnych usług ani danych produkcyjnych.

## Granice zabezpieczenia

Sekrety, konta demonstracyjne, lokalna kopia bazy i niezatwierdzony adres
rejestrowy pozostają w ignorowanym `.local/`, poza commitem. Zachowano pliki
źródłowe zamiast usuwać nieukończone szkice. Nie zmieniono `main`, produkcji,
DNS, domeny ani hostingu. Dalszy etap wymaga nowego polecenia właściciela.
