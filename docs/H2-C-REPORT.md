# H2-C — Accounts i Applications

## Wykonano

- Osobny moduł **Accounts**: rejestracje, oczekiwanie na e-mail, brak zgłoszenia,
  wnioski oczekujące, zatwierdzone, odrzucone i zawieszone konta. Dostęp wymaga
  łącznie `accounts.read`, `applications.read`, `counterparties.read` oraz MFA.
  Brak uprawnień do wniosków nie jest przedstawiany jako brak wniosku.
- **Applications** zawiera wyłącznie zgłoszenia z potwierdzonym e-mailem.
  Recenzenci widzą kraje, sektory, pełny opis działalności i zgłoszone dane firmy.
  Naprawiono `profile: {}` oraz RLS ukrywające dane przed Procurement/Sales.
- Wyszukiwanie, filtry, liczniki etapów i paginacja: domyślnie 12, maksymalnie
  24 rekordy; niepoprawne i wieloznaczne parametry są odrzucane. Liczniki Accounts
  uwzględniają wyszukiwanie, niezależnie od wybranego filtra etapu.
- Odrzucone zgłoszenia pozostają dostępne z uzasadnieniem. Historia decyzji jest
  dopisywana, chroniona w bazie i ładowana na żądanie w stronach. Starsza ostatnia
  decyzja jest oznaczona `legacy_snapshot`; brak wcześniejszej historii, daty lub
  recenzenta nie jest uzupełniany wymyślonymi informacjami.
- Zachowano istniejące zatwierdzanie/odrzucanie przez uprawnionych managerów,
  audyt, blokowanie/przywracanie kont i kontrolę OWNER. Decyzja dotyczy wyłącznie
  oczekującego wniosku; nie dodano ponownego otwierania zakończonych decyzji.
  Nowe uzasadnienie wymaga 10–2000 znaków w API i bazie.

Zatwierdzenie aplikacji użytkownika **nie potwierdza niezależnie istnienia firmy,
prawa do sprzedaży towaru ani kwalifikacji oferty**. Weryfikacja rejestrowa jest
przedmiotem późniejszego Sentinel; nie została uruchomiona w H2-C.

## Najnowsze rzeczywiste wyniki

Data: 21.10.2026. Testy wyłącznie na fikcyjnych, izolowanych instalacjach.

| Kontrola | Wynik i zakres |
|---|---|
| SQL 013 przed commitem | 9 grup PASS, transakcja zakończona ROLLBACK |
| SQL 014 przed commitem | 5 grup PASS, transakcja zakończona ROLLBACK |
| Loader/checksum/konfiguracja migracji | 7/7 PASS; testy bez połączenia z bazą |
| Interfejs z fikcyjnymi DTO | 4/4 PASS, Chromium 1440/390/320 i axe |
| Rzeczywisty PostgreSQL 17 + GoTrue + API + Caddy/TLS + Chromium | **13/13 grup PASS**, 38 s |
| Nowa regresja H2-A po H2-C | **10/10 grup PASS**, w tym 23 kontrole SQL, 79 s |
| Nowa regresja H2-B po H2-C | **7/7 grup PASS**, 17 s |

Rzeczywista regresja H2-C objęła obowiązkowe potwierdzenie e-maila, siedem ról
pracowniczych z MFA, odmowę przy niepełnych uprawnieniach, pełne profile,
filtrowanie/paginację, decyzje managerów i audyt, zachowanie odrzuconych zgłoszeń,
izolację Buyer/Supplier/Partner, zawieszenie i cofnięcie sesji, przywrócenie przez
normalne logowanie oraz widoki desktop/mobile i wylogowanie w kilku kartach.
Nie mockowano odpowiedzi API/Auth ani wyników SQL. Źródła snapshotu i kod produktu
porównano po wykonaniu — są identyczne.

Pierwszy częściowy run wykrył błąd oczekiwania **testu**: fikcyjny długi opis miał
końcową spację, którą istniejąca walidacja prawidłowo usuwa. Poprawiono fixture
testu; pełne kolejne wykonanie zaliczyło wszystkie 13 grup. Nie wykryto błędu
produktu wymagającego dodatkowej poprawki po commicie interfejsu/API.

Powtarzalny skrypt: `tests/h2-recruitment.integration.mjs`. Wymaga jawnie podanego
katalogu oznaczonego izolowanego fixture; nie akceptuje zwykłej instalacji
właściciela. Raporty lokalne: `/tmp/shadowbridge-h2c-policy-rollback.json`,
`/tmp/shadowbridge-h2c-history-rollback.json`,
`/tmp/shadowbridge-h2c-recruitment-regression.json`. Sekrety i backupy nie są
załączone do repozytorium.

## Regresja wcześniejszych etapów

Obie regresje wykonano **ponownie po H2-C**, na nowym izolowanym fixture z
aktualnym kodem i migracjami 001–014. To najnowsze wyniki, niezależne od
historycznych raportów H2-A/H2-B.

- **H2-A: 10/10 grup PASS** — dziewięć scenariuszy rejestracji i grupa 23 kontroli
  SQL. Trzy rejestracje dały trzy niezależne aplikacje (`1,1,1`); potwierdzanie w
  innej sesji, pierwotne role, duplikaty, współbieżność, wznowienie i izolacja
  pozostały poprawne. Respektowano rzeczywisty cooldown GoTrue. Dodatkowego
  identycznego run SQL nie powtarzano, bo jest już częścią aktualnego skryptu.
- **H2-B: 7/7 grup PASS** — rzeczywisty OWNER i MFA, 12 przejść między modułami
  przy 1440/390/320 px, pełne wspólne menu, zachowana sesja, wylogowanie w wielu
  kartach i poprawne przekierowanie anonimowego Offers do Member Sign In.
  Tym razem cały run zakończył się sukcesem, łącznie z ostatnim scenariuszem.

Raporty lokalne: `/tmp/shadowbridge-h2-registration-regression.json` oraz
`/tmp/shadowbridge-h2-navigation-regression.json`. Oba fixture pełnej regresji
H2-C i H2-A/B zatrzymano; kontenery i wolumeny zachowano. Pierwotny projekt
lokalny właściciela nadal działa. Nie uruchomiono **H3-A**.

## Dane i granice etapu

013 i 014 zapisano w `060a3f9` po próbach SQL z ROLLBACK, przed trwałym
zastosowaniem w nowym fixture. Interfejs/API zapisano w `d4a6f9c` przed pełnym
testem integracyjnym; skrypt i raport wyników C zapisano w `25574f9`.
Historycznych migracji 001–012 nie zmieniano.

Próby wstępne miały prywatny backup fikcyjnej bazy; po ROLLBACK fingerprinty
kont, rekordów haseł Auth, sesji, MFA, uprawnień, danych i polityk pozostały
identyczne. Pełne migracje wykonano wyłącznie w nowej bazie testowej. Nie
uruchamiano migracji ani resetów w bazie właściciela lub na Contabo.

Nie odczytywano/importowano/modyfikowano OWNER VAULT ani konta OWNER Vincent.
Nie wysyłano rzeczywistych e-maili, nie łączono się z VPS i nie zmieniano `main`,
produkcji, hostingu lub DNS. Nie korzystano z płatnych usług.

Nadal poza tym etapem: urzędowa weryfikacja firm, Sentinel, bezpieczny wybór
dodatkowych członków firmy zamiast ręcznego ID oraz prywatny portal C.A.R.T.E.L.
Nie deklarujemy gotowości całej platformy do produkcyjnego przyjmowania firm.
Nie testowano wdrożenia na Contabo, budowania nowego obrazu produkcyjnego ani
odtwarzania jego kopii. Lokalne testy używały istniejącego obrazu Node i
zamrożonego źródła aplikacji; wyniki nie zastępują tych kontroli wdrożeniowych.

Późniejsza aktualizacja wymaga osobnej decyzji właściciela i backupu:
[H2-STAGING-UPDATE.md](H2-STAGING-UPDATE.md). Następny proponowany etap to
**H3-A**, z wyraźnym rozdzieleniem wyniku kontroli rejestru,
zatwierdzania członkostwa i całkowitym wyłączeniem OWNER VAULT.
