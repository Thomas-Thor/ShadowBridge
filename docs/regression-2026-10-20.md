# Końcowa regresja lokalnego MVP — 20.10.2026

Gałąź `feature/secure-b2b-mvp`, punkt wyjścia `c9bf35e`. Wyłącznie fikcyjne dane,
rzeczywiste PostgreSQL, GoTrue, Mailpit i Chromium. Bez atrap API, publikacji,
płatnych usług ani wysyłki zewnętrznych e-maili. Nie rozpoczęto Intelligence CRM.

## Rzeczywiście wykonane testy

| Zakres | Wynik z 20.10 |
|---|---|
| Świeże `npm run demo`, restart aplikacji/kontenerów, aktualizacja `a4582db` → obecny kod | 7/7, ponowione na końcowej migracji 011 |
| Zajęty port, rzeczywiste TTY kont/MFA, zawieszony użytkownik, odrzucona aplikacja | 4/4; wcześniejszy przebieg przed 011 |
| Odmowa testowania oryginalnego projektu i ponownego użycia istniejącego wolumenu testowego | 2/2 |
| Główny proces B2B API oraz kolejka kontaktu | 14/14 + 6/6; 13 + 5 scenariuszy oraz dwa testy nadrzędne |
| RBAC API: wszystkie siedem ról, samodzielność managerów, OWNER i izolacja | 10/10, w tym 9 scenariuszy i test nadrzędny |
| Sesje i CSRF API | 6/6, w tym 5 scenariuszy i test nadrzędny |
| Przeglądarka: Buyer 390/320; Supplier/zarząd/Partner 1440/390/320; kontakt 1440/390/320; statyczny podgląd | 4 + 6 + 9 + 6 = 25/25 |
| Przeglądarka na 011: sesje/Overview/Team, Offers Workspace, siedem paneli pracowników | 6 + 2 + 7 = 15/15 |
| SQL/RLS na osobnej pustej bazie z 001–011 | 5/5 pakietów; wszystkie fikstury wycofane |
| Konfiguracja, polityka poczty i walidacja | 6/6 |

Pierwsze 25 testów przeglądarkowych wykonano przed poprawką 011; nie powtarzano
niezwiązanych zakresów. Zmienione tworzenie projektów sprawdzono następnie przez
RBAC API, rzeczywisty interfejs managera, SQL/RLS i ponowiony lifecycle z 011.
Starsze raporty z 18–19.10 pozostają historyczne; nie dodano ich do powyższych liczb.

Aktualizacja zachowała identyfikatory czterech kont, hashe haseł, MFA, plik ustawień,
oryginalne rekordy biznesowe oraz cztery aktywne sesje. Sprawdzono też zapis po
odnowieniu CSRF i logowanie tym samym hasłem. Migracje 001–010 są niezmienione;
końcowy test potwierdził nazwy i SHA256 wszystkich 11 pozycji rejestru migracji.

## Wykryte i naprawione problemy

- Demo używało starego CSRF po potwierdzeniu e-maila tworzącym nową sesję.
  Launcher pobiera teraz aktualne powiązanie przed kolejnym logowaniem.
- Operations Manager nie mógł utworzyć projektu: JOIN kont partnera był ukryty
  przez RLS. Nowa 011 sprawdza kwalifikację odbiorcy przez autoryzowaną funkcję
  zwracającą tylko boolean, również w polityce INSERT. Nie dodano `accounts.read`.
  Sprawdzono odmowy bez MFA, dla NULL, Analyst, roli sesji i zawieszonych partnerów.
- Stare testy SQL wymagały dostosowania fikstur do RBAC, kategorii i kwalifikacji
  dostawcy. Pierwsza próba bazy SQL bez seedów/ACL była błędem przygotowania testu;
  końcowa baza została utworzona przez rzeczywiste migracje, bez osłabiania polityk.
- Rozszerzony test kontaktu przekraczał prawidłowy limit 5 zgłoszeń/IP/15 minut.
  Oddzielono rzeczywiste adresy loopback kontekstów testowych; końcowe 9/9 przeszło.
  Limit i liczniki pozostały włączone. Uaktualniono polecenia i historyczne opisy.

## Dane, backup i ograniczenia

Przed testami zapisano chronioną lokalną kopię bazy, ról i konfiguracji w ignorowanym
`.local/stage2-backup-20261020/`. Odtworzenie danych w osobnej bazie potwierdziło
zgodność wszystkich 55 tabel. Nie był to pełny test odtworzenia Auth/MFA z usługami,
uprawnieniami i infrastrukturą: próbę danych wykonano bez odtwarzania ACL/własności.
Po testach porównano zastaną bazę: 55/55 tabel i 3/3 plików konfiguracji/kont mają
identyczne fingerprinty jak przed testami. Oryginalna baza nadal ma 10 migracji;
nie wykonano na niej 011 ani resetu. Przywrócono jej dotychczasowe kontenery,
a testowe wyłączono bez usuwania wolumenów. Serwer aplikacji pozostaje zatrzymany,
tak jak przed etapem. Nie zmieniono komputera właściciela ani jego lokalnych danych.

Nie pozostały nieukończone lub pominięte testy zaplanowanej regresji lokalnej.
Wstępne błędy launchera, uprawnień, przygotowania bazy SQL i izolacji kontaktu
mają zakończone ponowienia; nie są ukryte jako pominięcia. Niezwiązanych pakietów
nie powtarzano po zmianach dotyczących pojedynczych zakresów.

Pozostają poza wykonaną regresją lokalną: zewnętrzne SMTP/HTTPS i hosting, pełna
procedura odzyskiwania OWNER, szyfrowane kopie poza środowiskiem i pełne odtworzenie
wdrożenia. Staging nadal jest niedokończonym szkicem. Upload, C.A.R.T.E.L. membership,
szczegółowe uprawnienia pracowników kontrahentów i nowe moduły biznesowe nie są gotowe.
Nie badano ponownie komputera Pop!_OS właściciela ani aktywności numeru WhatsApp.

`main`, CNAME, wygląd publicznej witryny, `/cartel/`, DNS i hosting pozostają bez
zmian. Nieśledzony dokument Cloudflare z 18.10 zachowano bez zmiany SHA256.

Intelligence CRM można rozpocząć jako osobny lokalny etap po poleceniu właściciela;
ten raport nie jest zgodą na przetwarzanie rzeczywistych danych ani publikację.
