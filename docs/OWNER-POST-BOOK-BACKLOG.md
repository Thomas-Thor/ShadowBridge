# Kolejka OWNER po zakończeniu Book

Decyzja OWNER: **kolejka, bez implementacji teraz**. Priorytetem pozostaje
działające połączenie ChatGPT z Book oraz kontrolowane uporządkowanie danych.
Ten dokument nie oznacza zapisu do produkcyjnego Book ani wdrożenia modułów.

## 1. OWNER Search — moduły i wpisy

Stabilna referencja propozycji: `owner-post-book-v1:owner-search`.

- Widoczna lupka w Command Center; wyszukiwanie dostępnych modułów, ustawień,
  zadań, notatek i pozostałych wpisów OWNER.
- Wynik zawiera nazwę, krótkie objaśnienie, rodzaj/status oraz bezpośredni odnośnik.
- Wyraźne odróżnienie działającego modułu od notatki opisującej plan.
- Kontrola dostępu również w API/PostgreSQL; bez ujawniania zasobów niedostępnych
  dla konta. Zachowanie OWNER + MFA oraz prywatności danych.
- Ograniczone wyniki, paginacja i wygodna obsługa na telefonie/klawiaturą.

Stan sprawdzony w kodzie `14cc879`: istnieją osobne wyszukiwarki wpisów Book
i CRM, ale brak globalnego OWNER Search oraz lupki obejmującej moduły i wpisy.

## 2. OWNER Finance — wcześniejszy pełny zakres

Stabilna referencja propozycji: `owner-post-book-v1:owner-finance`.

- Przychody, wydatki, należności, zobowiązania i prowizje.
- Operacja: kto, komu, za co, kwota, waluta, kategoria, projekt, data, termin
  płatności i status; powiązanie z usługą/transakcją i dokumentem źródłowym.
- Faktury, potwierdzenia i eksport dla księgowości; prywatny dostęp do plików
  dopiero z gotową, sprawdzoną kontrolą przechowywania i uprawnień.
- Salda rachunków/gotówki z datą i źródłem, budżety, rezerwacje i dostępne środki.
- Analiza kosztów według okresu, kategorii, projektu, usługi i osoby; historia
  zmian z informacją kto, kiedy i co zmienił.
- Środki dostępne oddzielone od oczekiwanych wpływów; rezerwacja budżetu
  oddzielona od rzeczywistego wydatku.
- Bez sumowania walut bez zapisanego kursu, daty i źródła. Braki i nieaktualność
  danych widoczne zamiast pozornego dokładnego salda.
- Powiązanie z Credit Ledger bez podwójnego naliczania kosztów. Nie wyliczać
  wydatków z niejednoznacznych sald kredytów. Nie tworzyć drugiej ewidencji
  tej samej operacji.
- Domyślnie wyłącznie OWNER; partner/księgowy dopiero po jawnym nadaniu dostępu.
  Osobne prawa podglądu, dodawania, edycji i eksportu w API, bazie i plikach.
  Dostęp do finansów nie daje dostępu do Secure Vault.
- Integracje bankowe i płatne usługi nie są automatycznie zatwierdzone.

Stan sprawdzony w kodzie `14cc879`: są prowizje, limity i kontrolowane decyzje
finansowe. Brak osobnego OWNER Finance. Credit Ledger w przygotowanym materiale
to format notatek, nie gotowa strukturalna analityka kosztów.

## Zasady przeniesienia do rzeczywistego Book

1. Nie zmieniać ani nie rozszerzać obecnej paczki 25 historycznych propozycji.
2. Po zakończeniu połączenia i importu Book odczytać aktualne zadania, źródła
   i archiwum. Historyczne wzmianki nie są automatycznie zadaniami do wykonania.
3. Porównać referencje, treść i identyfikatory. Istniejących zadań nie dublować;
   rozbieżność zakresu pokazać OWNER, nie nadpisywać automatycznie.
4. Wyświetlić brakujące propozycje do zatwierdzenia. Użyć istniejącego procesu
   podglądu, zgody, backupu, importu i ponownego odczytu. Zależności ustawić
   wyłącznie na podstawie rzeczywistych identyfikatorów z Book.
5. Nie obchodzić limitu 25 wpisów/60 minut ani cofniętego uprawnienia zapisu.
   W razie potrzeby osobna zgoda OWNER, nigdy automatyczne przedłużenie.

Aktualny stan: **zapisane w kolejce repozytorium i prywatnym szkicu; brak zapisu
do produkcyjnego Book**. Brak implementacji i wdrożenia. Dotychczasowy instalator
pozostaje przypięty do `14cc8796cf718cc15e1ca1cc63154ed078685c6d`; ten dokument
nie wymaga aktualizacji działającej aplikacji.
