# Checkpoint: prepare, sourcing i poczta — 25.10.2026

## Stan produkcji: zgłoszony, nie odczytany przez Codexa

OWNER przekazał: checkout `14cc8796cf718cc15e1ca1cc63154ed078685c6d`,
aplikacja `599fc3359ecd3d87868cb6056e35214c0baa3c00`, 19 migracji, create=false,
preflight bez blokad, katalog nowego wydania istnieje, brak state.json.
Wcześniejszy odbiór OAuth był potwierdzony. Nie kierować ponownie do ustawień
OAuth ani nie wykonywać resetów/migracji. Brak state.json nie dowodzi braku
artefaktów build/planu; pierwotnej przyczyny nie wolno odgadywać.

## Naprawione w kodzie operatora

- Każda próba prepare ma osobny prywatny dziennik etapów 0600, zapisywany i
  synchronizowany na dysk jeszcze przed powstaniem głównego checkpointu.
- Wiadomo, czy błąd wystąpił przy odbiorze poprzednika, inwentaryzacji, preflight,
  świeżym MFA, buildzie, planie czy zapisie checkpointu.
- Kolejne próby mają unikalny build-UUID.log. Zachowany build.log nie jest
  nadpisywany ani usuwany i nie blokuje nowej próby przez EEXIST.
- Błąd polecenia zachowuje bezpieczną kategorię i kod zakończenia zamiast
  ukrywać wszystko pod ogólnym komunikatem. Bez argumentów, surowych logów,
  sekretów lub danych kontrahentów w komunikacie.
- Blokady, fingerprinty, świeże OWNER MFA, backup/offsite i brakujące-only
  migracje pozostają obowiązkowe. Nie wznowiono ani nie wdrożono produkcji.

To naprawia rzeczywiste problemy diagnostyki/ponowienia w kodzie. Nie jest
potwierdzeniem, że EEXIST był pierwotną przyczyną na Contabo.

## Jedna następna czynność operatora

Uruchomić przypięty sumą `scripts/r1-prepare-observe.mjs` z raportu tej wersji,
przez istniejące SSH shadowadmin i sudo. Argument --release musi wskazywać
**nieudane 14cc879**, nie SHA nowego narzędzia.

To samodzielny skrypt bez zależności npm. Nie zmienia checkoutu, checkpointów,
kontenerów, konfiguracji ani danych. Odczytuje tylko bezpieczne metadane śladów
prepare, klasyfikuje końcówkę zachowanego logu bez jej publikacji, sprawdza
rewizje obrazów, aktualną aplikację, tryb poczty, liczbę migracji i anonimowe
GET istniejącego lokalnego API n8n. Nie wywołuje dostawców ani SMTP.

401 API n8n bez klucza jest prawidłową odmową, nie dowodem braku istniejących
połączeń Apollo/Clay. Metadane obecności SMTP nie dowodzą dostarczenia wiadomości.
Liczba ostatnich zdarzeń MFA to agregat, nie zastępstwo odbioru OWNER.
Brak zapisanego konkretnego błędu pozostaje UNRECORDED, a nie domniemaną przyczyną.
Zwrócić wyłącznie oczyszczony JSON. Nie przesyłać surowego build.log/env/sekretów.

Po wyniku: naprawa wykazanej przyczyny i wznowienie właściwego etapu. Nie usuwać
locka lub planu, nie ponawiać migracji i nie uruchamiać instalatora w ciemno.

## Apollo / Clay / centralny CRM

Sprawdzono istniejącą gałąź acquisition `49d3ab8`: workflow, deduplikacja,
bramka kosztów i importer pozostają zachowane. Nie rekonfigurowano wtyczek.
Zakres jednorazowego budżetu został zatwierdzony w rozmowie i zachowany
prywatnie; nie jest dowodem aktualnego salda, ceny wywołania ani połączenia.

W tej sesji brak wywoływalnych narzędzi Apollo/Clay/n8n i autoryzowanego SSH.
Gałąź acquisition ma oddzielną bramkę serwerową i SQL guard; nie ma ich w
uruchomionym R1 599fc33 ani w tej poprawce operatora. Nie wolno wdrażać starszej
aplikacji acquisition na R1 lub zastępować ograniczonego principalu sesją OWNER.
Rzeczywistą konfigurację istniejącego n8n trzeba odczytać, nie odtwarzać z wzorców.
Przed pierwszym wywołaniem kosztowym potrzebne są aktualne limity, prawo API,
sprawdzony CRM check/write/readback i brak niejednoznacznego duplikatu.
Telefony i wysyłka wiadomości pozostają wyłączone. Firma bez dowodu towaru to LEAD.
SCHEDULED: nie; EXECUTED: nie; rzeczywiste rekordy zapisane przez tę sesję: **0**.

## Gmail / rejestracja

Istnieje obsługa Gmail SMTP z hasłem aplikacji, wymagana weryfikacja e-mail oraz
reset w GoTrue. Odzyskanie zwykłego logowania Google/2FA nie potwierdza SMTP.
Żadne hasło nie jest wymagane w czacie. Jeżeli potrzebna jest autoryzacja, tylko
obsługiwanym sposobem w prywatnym terminalu serwera/magazynie poświadczeń.

Nie zmieniać ręcznie flag lub fingerprintów aktywnego profilu w trakcie prepare.
Po przywróceniu kontrolowanej aktualizacji trzeba potwierdzić konfigurację SMTP
i rzeczywiste dostarczenie na kontrolowane konto testowe: rejestracja, poprawna
domena linku, aktywacja, panel właściwej roli, reset, ważność/jednorazowość linków.
Bez tego publiczna rejestracja i odzyskiwanie pozostają wyłączone.
W tej sesji nie wykonano rzeczywistej wysyłki, rejestracji ani resetu na produkcji.

## Weryfikacja tej poprawki

17 celowanych testów PASS: bezpieczna diagnostyka, dzienniki/ponowienie,
regresja koordynatora, rzeczywisty Compose config, szyfrowane kopie planu i
rollback aplikacji. Fikstury, nie Contabo. Testy brakujących migracji/append
aplikacji z poprzedniego checkpointu nie były niepotrzebnie ponawiane.
Pliki runtime i migracje 001–020 nie zmieniły się względem 14cc879.
