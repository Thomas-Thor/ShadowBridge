# H2-A — niezależne rejestracje i wznowienie zgłoszenia

## Naprawa

Odtworzono rzeczywisty błąd: trzy rejestracje w jednej przeglądarce i potwierdzenia
w kolejności 2→1→3 dawały liczbę wniosków **0, 0, 1**. Jedno ciasteczko
`sb_application_intent` było nadpisywane przez następne zgłoszenie.

Nowa migracja **012** zapisuje prywatny szkic związany z konkretnym kontem Auth
podczas jego utworzenia. Powiązanie wymaga serwerowego losowego nonce i zgodnego
e-maila; odpowiedź signup ani ciasteczko nie są dowodem tożsamości. Dopiero
potwierdzona, aktywna sesja może atomowo utworzyć własny wniosek i profil.
Równoległe potwierdzenie/logowanie jest idempotentne. Pierwotna rola i dane firmy
nie są nadpisywane przez ponowny signup.

Starsze, zachowane intencje pozostają w bazie. Jednoznaczne aktualne zgłoszenie
może zostać wznowione po weryfikacji; konflikt lub wygaśnięcie wymaga świadomego
wyboru własnego zapisanego zgłoszenia. Interfejs pokazuje pierwotną rolę i dane,
bez swobodnej zamiany Partnera w Supplier. Wznowienie i wybór trafiają do audytu.
Nie przyznaje to dostępu do prywatnych ofert ani zatwierdzenia firmy.

## Rzeczywiście wykonane testy

- Osobna instalacja PostgreSQL 17 + GoTrue + API + Caddy/TLS + Mailpit, wyłącznie
  fikcyjne dane. Chromium korzystał z rzeczywistych formularzy, bez mockowania API.
- **9/9 scenariuszy integracyjnych PASS**: trzy zgłoszenia w jednej przeglądarce
  (**1, 1, 1**), potwierdzanie w innej sesji, zaakceptowany duplikat po prawdziwym
  cooldown GoTrue, dwa równoległe pierwsze logowania (jeden wniosek i audyt),
  ponowny signup konta już potwierdzonego, odzyskanie pojedynczego zgłoszenia,
  jawny wybór spośród konfliktowych/wygasłych zgłoszeń w UI, odmowa cudzej
  referencji i brak podmiany nowej roli przez stare zgłoszenie.
- Pełny profil (kraje, sektory, opis) i pierwotna firma/rola zachowane; historia
  starych intencji niezmieniona. Niepotwierdzone/niezatwierdzone konta nie otrzymują
  prywatnego dostępu.
- Migracje 001–012 faktycznie zastosowane **wyłącznie w nowej bazie testowej**.
  Kontrola loadera/checksum/transakcji: **7/7 PASS**. Historycznych migracji
  001–011 nie zmieniano.
- Oddzielny rzeczywisty test SQL: **22 kontrole PASS** — obie role runtime nie
  odczytują/nie zmieniają nowych tabel bezpośrednio; szkic jest niezmienny,
  funkcje odrzucają brak tożsamości, niepotwierdzone lub zawieszone konto.
  Fikcyjny stan zawieszenia był ustawiany wyłącznie w transakcji testowej;
  rollback przywrócił konto i flagę istniejącego triggera ochronnego.
- Następnie osobno wykonano **1 dodatkowy SELECT PASS**: zaakceptowany duplikat
  nadal wskazuje pierwotny intake i rolę Partner. Nie ponawiano całego testu SQL;
  skrypt do przyszłych uruchomień obejmuje już wszystkie 23 kontrole.

Wyniki maszynowe wykonania lokalnego: `/tmp/shadowbridge-h2-registration-baseline.json`
oraz `/tmp/shadowbridge-h2-registration-regression.json` i
`/tmp/shadowbridge-h2-registration-sql-permissions.json`; pliki te są lokalnymi
artefaktami testów, nie odnośnikami do pobrania. Ten raport zapisuje ich istotne
wyniki w repozytorium. Powtarzalny test: `tests/h2-registration.integration.mjs`,
z wymaganym jawnym katalogiem izolowanego fixture przygotowanego skryptem H1.
Skrypt odmawia użycia zwykłej instalacji właściciela.

## Ograniczenia i dalsze etapy

- Nie odtworzono danych, które poprzedni kod zdążył już usunąć. Jeśli nie ma
  żadnej zachowanej intencji, użytkownik świadomie wypełnia brakujące zgłoszenie;
  system nie zgaduje historycznej firmy/roli. Starych kont nie zmodyfikowano.
- Nowe intake’y zawierają dane zgłoszenia, ale nie hasło. Nie są automatycznie
  kasowane po błędzie dostawcy, aby nie stracić kończącej się asynchronicznie
  rejestracji. Polityka retencji i kontrolowane porządkowanie pozostają do
  zatwierdzenia przed rzeczywistym naborem.
- To regresja rejestracji, nie całego RBAC/CRM. Naprawa `profile: {}` w liście
  administratora, rozdzielenie Accounts/Applications i statusy firm należą do
  kolejnych etapów H2; nie są jeszcze wykonane w tym commicie.
- Nie wysłano zewnętrznej poczty i nie wykonano aktualizacji Contabo, próby
  odtworzenia jego backupu ani ponownej pełnej regresji obrazów/lifecycle.
  Wcześniejsza blokada budowania obrazu przez DNS npm nie jest wynikiem PASS.
  Test użył lokalnego obrazu Node z zamrożoną kopią źródeł i istniejących zależności.
- Historyczny test bezpieczeństwa porównywał całe `raw_user_meta_data` po
  natychmiastowym duplikacie, który mógł być odrzucony przez throttling. GoTrue
  może zmieniać te niezaufane metadane niepotwierdzonego konta. Test porównuje
  teraz niezmienną tożsamość i zapisany szkic; autoryzacja nie korzysta z bieżącej
  wartości metadanych. Całej historycznej suite bezpieczeństwa nie ponawiano;
  rzeczywisty zaakceptowany duplikat i zachowanie pierwotnego zgłoszenia zostały
  sprawdzone w dziewięciu scenariuszach H2-A.
- Dane, konta i wolumeny właściciela pozostają poza fixture testowym. Konfiguracji
  `.local/` istniejącej instalacji nie regenerowano.

Obie nowe instalacje testowe zatrzymano; kontenery i wolumeny zachowano.
Istniejący lokalny projekt właściciela pozostał uruchomiony.

Bezpieczna późniejsza aktualizacja: [H2-STAGING-UPDATE.md](H2-STAGING-UPDATE.md).
