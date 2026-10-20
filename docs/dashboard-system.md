# Etap B — system dashboardów ShadowBridge

Zakres: wyłącznie frontend istniejącego MVP, na podstawie audytu etapu A.
Bez nowych endpointów, modułów biznesowych i zmian uprawnień. Stan 20.10.2026.

## Hierarchia i styl

Grafitowe tło, ciemne karty, jasna typografia, cienkie linie oraz pojedynczy
brązowo-szampański akcent dla aktywnej nawigacji i ważnych działań. Czytelne
statusy z tekstem; kolor nigdy nie jest jedynym nośnikiem informacji. Bez
zewnętrznych fontów, bibliotek wykresów, animowanych liczb i pozornych trendów.

Wspólny shell: sidebar z istniejącymi dozwolonymi wejściami, nagłówek konta,
status dostępu, obszar podsumowania, moduły szczegółowe i polityka poufności.
Na wąskim ekranie nawigacja staje się zwartym paskiem z dostępnym przewijaniem.
Formularze, identyfikatory DOM i istniejące przyciski pozostają funkcjonalne.
Przed MFA nie montujemy prywatnych widgetów; przy zmianie sesji czyścimy również
zawartość nowego shell. Wygląd nie zastępuje autoryzacji API/RLS.

## Wspólne komponenty i dane

| Komponent | Kontrakt i zachowanie |
|---|---|
| KPI / stat card | Etykieta, wartość, opis zakresu, opcjonalny dozwolony link. Brak pola w DTO oznacza niedostępne dane, nie zero. |
| Status distribution | Dostępna lista statusów z liczebnością i poziomymi słupkami/miernikami. Zawsze podpis „loaded records”, gdy źródłem jest ograniczona lista. Nie udaje historii czasowej ani konwersji. |
| Activity list | Dla firm: ostatnio zmienione własne rekordy z odebranej listy. Dla zarządu: najwyżej 12 autoryzowanych zdarzeń audytu. Czas i zakres jawne; bez statusu online. |
| Alert / empty state | Oddzielne komunikaty: ładowanie, błąd, zero rekordów, brak integracji. Błąd nigdy nie daje zielonej wartości zero. |
| Next actions | Linki do istniejących szkiców, wyjaśnień, przydziałów lub kolejek. To sugestie na podstawie statusów, nie nowy system zadań. |
| Section header | Tytuł, krótki opis źródła danych i ewentualny link do pełnego modułu. |
| Compact rows / tables | Krótkie etykiety, status i data; na telefonie zawijanie lub lokalny scroll. Zachować istniejący szczegół i rozmowę. |

Komponenty powstają jako lokalne DOM/CSS, bez instalacji zależności. Dane
wstawiane przez `textContent`, bez HTML z serwera i bez zapisu w localStorage.
Podsumowania aktualizują się po istniejących odczytach list i po zapisie,
nie wymagają dodatkowego dostępu do poufnych baz. Odpowiedź po zmianie sesji
nie może ponownie wstawić danych do wyczyszczonego panelu.

## Widgety zależne od roli

| Workspace | Dane i rzeczywiste widgety | Czego nie deklarujemy |
|---|---|---|
| Buyer | Własne RFQ: odebrane rekordy, szkice, review, wyjaśnienia; rozkład statusów i ostatnie zmiany. Osobno `total` przypisanych anonimowych okazji dla bieżących filtrów. Linki do RFQ, rozmów i okazji. | Globalny katalog dostawców, licznik unread, terminy follow-up i wartość zakupów. |
| Supplier | Własne oferty: szkice, submitted, clarification, approved; rozkład review, ostatnie zmiany i istniejące dalsze kroki. | Sprzedaż, przychód, popyt całego rynku ani tożsamości kupujących. |
| Partner | Własne propozycje, przydzielone projekty i ich statusy. Umówione kwoty osobno dla każdej waluty; aktualny zakres maks. 200 rekordów na listę. | Wynik finansowy, ROI, konwersja, aktywne leady CRM, automatyczna prowizja lub przeliczanie walut. |
| Owner / Director / Operations i inni pracownicy | Wyłącznie zwrócone liczniki `/api/staff/overview`, kolejki reakcji, porównanie obciążeń kolejek i dozwolona aktywność. Moduły dobierane według efektywnych permissions, nie tytułu stanowiska. | Globalny licznik firm, SLA, online monitoring, trendy historyczne i nieistniejące taski. |
| Analyst | Spokojny Overview z dostępnymi wartościami; brak innych danych nie jest błędem ani zerowym wynikiem firmy. | Dziedziczenie statystyk OWNER lub automatyczny dostęp do CRM. |

Kwota `null` oznacza niepodaną wartość. Nie sumujemy różnych walut ani nie
przedstawiamy umówionej prowizji jako zapłaty. Źródła ograniczone do 200 pozycji
pozostają opisane jako snapshot; tylko endpointy z `total` dają licznik całości.
Łączne liczniki różnych kolejek nie są liczbą unikalnych transakcji lub firm.

## Sprawdzenie implementacji C–E

Targetowane UI/smoke w Chromium: 1440/390/320 px, nawigacja i klawiatura,
brak overflow, stany pusty/błąd/brak MFA, aktualizacja po zapisie, brak danych
innej roli, brak danych po zmianie sesji i istniejące formularze/przyciski.
Testy prezentacji mogą używać wyraźnie fikcyjnych DTO w izolowanym transporcie
testowym; raport musi je odróżniać od prawdziwych testów backendu. Bez migracji,
zmian danych właściciela i uruchamiania nowego środowiska internetowego.
