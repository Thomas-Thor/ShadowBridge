# European B2B Scout V1 — checkpoint 23.10.2026

## Aktualizacja 24.10.2026 — tylko weryfikacja źródeł

**5 celowanych testów PASS**, bez pełnego ponowienia zestawów poniżej.
Źródła `NO/CZ=false`, JSON nieaktywny i zgodny z generatorem. Nie uruchamiano
Docker/n8n. Próby oficjalnych API/dokumentacji zablokował CONNECT proxy 403,
również poza sandboxem. Nie uzyskano rzeczywistych odpowiedzi ani danych firm.

Dwie dodatkowe próby w pamięci na fikcyjnych danych ujawniły brak obsługi flagi
przymusowego rozwiązania firmy oraz zachowanie parsera dla pustego HAL bez
`_embedded`; nie są to testy realnego API ani naprawy. Kod i JSON nie zmieniły się.
Opis ograniczeń/poprawek: [raport źródeł](SOURCE-VERIFICATION-2026-10-24.md).
Poniższe 18/18 i 8/8 pozostają **wynikami historycznymi z 23.10**, nie nowymi.

**Wynik: techniczny pilot przetestowany lokalnie. Pozyskiwanie z rzeczywistych
rejestrów NIEZATWIERDZONE do uruchomienia; bieżący dostęp i warunki NO/CZ wymagają
potwierdzenia. Nie wdrożono niczego na Contabo ani w istniejącym n8n.**

## Najnowsze wykonane testy

### Logika i artefakt: 18/18 PASS

`node --test automation/europe-scout/scout.test.mjs`

- JSON odpowiada generatorowi; workflow nieaktywny, flagi NO/CZ wyłączone,
  brak credentials, Code, AI, SQL, Execute Command i połączeń z CRM.
- Brak zatwierdzenia źródła: brak rezerwacji i zapytania.
- Ta sama firma wielokrotnie, podobne nazwy różnych firm, różne kraje i numery:
  deduplikacja wyłącznie przez stabilną tożsamość.
- Brakujące pola, nieprawidłowy ID/nazwa, niewłaściwa forma prawna, jawnie
  nieaktywna firma, hotel zamiast wybranego sektora: brak wymyślonych wyników.
  Brak kopiowania danych pracowników i e-maili; WWW tylko jawnie podane w źródle.
- 25 nowych firm/kraj, 50/dzień, częściowy zapis przy niemal wykorzystanym limicie,
  4 próby HTTP/kraj i 8/dzień, ograniczenie po przerwanym wykonaniu.
- 429 Retry-After jako sekundy i data HTTP, także niereprezentowalnie duża wartość;
  5xx, timeout, 403 i zmiana schematu: cooldown lub blokada, bez fikcyjnych firm.
- Potwierdzenie zwycięskiego warunkowego zapisu, odrzucenie obcego/starego wyniku,
  wygaśnięcie rezerwacji, odzyskanie po przerwaniu.
- Rotacja dwóch krajów i pięciu sektorów przez kolejne daty; dzień kalendarzowy
  Oslo przy zmianie czasu; cron ustawiony na 03:15 (kontrola konfiguracji).
- Brak/duplikat/uszkodzony journal, w tym tablica zamiast mapy: zatrzymanie;
  limit 500 firm: brak dalszego pozyskiwania.

### Rzeczywiste n8n 2.44.6: 8/8 PASS

`node automation/europe-scout/n8n.integration.mjs`

Obraz `n8nio/n8n:2.44.6`, digest:
`sha256:d02752c6ab446ae9db8deec2f9cc887c378f77cdcad31650814df936b7386dfb`.
Rzeczywisty proces n8n, jego REST import/execute, natywne HTTP Request, Set, IF,
Loop, Wait i Data Tables. **SQLite nowej instancji n8n**, bez połączenia z bazą MVP.
Odpowiedzi rejestrów wyłącznie z lokalnego serwera fikcyjnych rekordów, nie
z podstawionych wyjść węzłów n8n. Utworzono losowy, izolowany kontener i sieć;
port edytora tylko localhost. Konto testowe i hasło wygenerowane w pamięci.

1. Import i wykonanie z wyłączonymi źródłami: revision 0, bez zapisów.
2. HTTP → warunkowy UPDATE natywnej tabeli: 25 fikcyjnych NO + 25 CZ,
   50 firm i prawidłowy limit dzienny, zdarzenia obu źródeł.
3. Ponowne wykonanie tego dnia: żadnych nowych zapytań, zmian revision ani duplikatów.
4. Nowy budżet z zachowanymi kandydatami: deduplikacja po trwałym zapisie, zero nowych.
5. Rzeczywiste odpowiedzi fixture 429 z Retry-After 172800 i 503:
   zapis opóźnienia, próba niezależnego drugiego źródła, brak kandydatów.
6. Faktyczny timeout węzła HTTP po 15 s i błędny JSON schematu:
   bezpieczne odroczenie/blokada i brak firm.
7. Dwa równoczesne wykonania: dokładnie 50 unikalnych kandydatów i budżet
   dwóch zapytań. Sprawdzono faktyczny warunkowy zapis natywnej tabeli.
8. Restart tego samego kontenera: pełny wiersz journal identyczny przed i po restarcie.

Po udanym teście usunięto **wyłącznie zasoby utworzone przez tę próbę**: jej
kontener, sieć i katalog z fikcyjnym stanem. Wcześniejszych danych ani wolumenów
nie resetowano. Test nie importuje ani nie aktywuje workflow na istniejącym n8n.

## Znalezione i usunięte problemy

- Parser wyrażeń n8n odrzucał `catch {}` w osadzanej funkcji: jawny parametr catch.
- Zagnieżdżone przekazanie flag zgody i opcjonalny dynamiczny dostęp do pola
  powodowały pomijanie źródeł mimo `true`: snapshot JSON konfiguracji i zwykły
  dostęp do pola. Sprawdzono ścieżkę `false` i `true` na rzeczywistym n8n.
- Jawne `outputPropertyName: body` dla tekstowej odpowiedzi HTTP zapewnia
  zgodność z parserem odpowiedzi; nie polegamy na domyślnym polu `data`.
- Skrajnie duży Retry-After nie skraca żądanej przerwy: blokuje źródło do przeglądu.
- Środowisko testowe miało pełny dysk i sterownik Docker VFS. Przeniesiono dane
  i cache wyłącznie nowej instancji do prywatnego katalogu tymczasowego;
  nie czyszczono istniejących obrazów, kontenerów ani wolumenów.
- Docker potrafi zmienić losowy port hosta przy restarcie. Harness ponownie odczytuje
  mapowanie przed sprawdzeniem danych. Nie była to utrata journal.

Ostateczny przebieg powyższej komendy zakończył się kodem 0 i komunikatem
`RESULT 8 real n8n checks passed`. Wcześniejsze nieudane próby przygotowawcze nie
są przedstawiane jako sukces. Testów całego MVP nie uruchamiano: jego kod nie zmienił się.

## NIEPRZETESTOWANE / ograniczenia

- Oficjalne API Brreg i ARES oraz bieżące strony dokumentacji/warunków:
  **403 z proxy środowiska**, również po ponowieniu poza sandboxem.
  To blokada odczytu, nie dowód braku firm. Nie pozyskano ani nie opublikowano
  próbki prawdziwych danych. Nie gwarantujemy aktualnego formatu/warunków ARES.
- Rzeczywisty nocny wyzwalacz nie czekał do 03:15; sprawdzono cron, timezone i
  rotację dat w testach oraz wykonania ręczne. Nie deklarujemy nocnego przebiegu.
- Konfiguracja konkretnego n8n na Contabo oraz inny backend Data Tables
  (np. PostgreSQL zamiast testowanego SQLite) nie były uruchamiane ani zmieniane.
- PL, DE i NL: tylko analiza źródeł. Nie ma adapterów, kluczy ani płatnych API.
- Pilot ogranicza się do spółek wskazanych form i pięciu grup branżowych,
  maks. 500 kandydatów; journal wymaga ręcznego przeglądu/eksportu.
  Nie stanowi pełnego europejskiego katalogu ani dowodu towaru/nadwyżek.
- Brak odświeżania danych istniejącej firmy, weryfikacji reprezentacji,
  korespondencji handlowej, AI, kontaktów osobowych i automatycznego zatwierdzania.
- OWNER VAULT V3 pozostaje wyłączony. Obecne V1 wymaga osoby kontaktowej;
  potrzebny osobno zatwierdzony company-only intake, retencja i podstawa przetwarzania.

## Przed uruchomieniem pilota

Operator musi potwierdzić aktualne źródła/licencje oraz pojedynczy legalny odczyt
według `SOURCES.md` i `README.md`. Dopiero potem może ręcznie zatwierdzić kraj
w konfiguracji i aktywować workflow. Nie omijamy limitów ani nie zastępujemy
niedostępnego API scrapingiem. Do tego czasu gotowy pakiet pozostaje nieaktywny.
