# SCOUT SURPLUS & LIQUIDATIONS — zakres do przyszłego zatwierdzenia

**Wyłącznie dokument. Bez adapterów, workflow, harmonogramu, importu lub kontaktu
z firmami. Dotychczasowy pilot producentów/hurtowników pozostaje bez zmian.**

## Osobny cel

Wyszukiwać udokumentowane oferty palet/stocklots, nadwyżek produkcyjnych,
końcówek kolekcji, zapasów likwidacyjnych i wyprzedaży przedsiębiorstw.
Rozróżniać towar, przedsiębiorstwo i zdarzenie prawne. Sam kod branży lub
upadłość nie dowodzi istnienia dostępnych zapasów ani prawa do ich sprzedaży.

| Rodzaj sygnału | Co rzeczywiście oznacza |
| --- | --- |
| Producent/dystrybutor w rejestrze | Kandydat B2B; brak dowodu nadwyżek — obecny pilot |
| Deklaracja stocklot/palety | Oferta zadeklarowana przez źródło; ilość, dostępność i umocowanie do sprawdzenia |
| Urzędowe ogłoszenie upadłości/likwidacji | Udokumentowane zdarzenie prawne; brak automatycznego dowodu konkretnego towaru |
| Likwidator/syndyk | Potencjalny uprawniony sprzedający; mandat dla danej sprawy wymaga sprawdzenia |
| Zweryfikowany konkretny lot | Dopiero po ludzkiej kwalifikacji dokumentów, prawa sprzedaży i towaru |

Obecny pilot odrzuca `konkurs`/`underAvvikling`. Tych zabezpieczeń nie usuwać,
aby uzyskać więcej leadów. Przypadki likwidacyjne będą miały odrębny proces
ryzyka, powiązany z firmą, bez przedstawiania jej jako kwalifikowanego dostawcy.

## Źródła do oceny — nie źródła zatwierdzone

- Oficjalne ogłoszenia/rejestry upadłości i likwidacji, początkowo Norwegia
  (Brønnøysundregistrene / Kunngjøringer) i Czechy (oficjalny rejestr insolwencyjny).
  Osobno sprawdzić automatyczny dostęp, licencję, retencję i zakres danych firm.
- Oficjalne strony/feedy syndyków, likwidatorów i autoryzowanych sprzedających.
  Publiczna strona nie oznacza prawa do maszynowego pobierania.
- Zatwierdzone feedy/API ofert producentów i stocklotów oraz źródła aukcyjne
  dopiero po sprawdzeniu warunków i ewentualnej zgody operatora źródła.

Bez CAPTCHA, proxy/rotacji IP, nieuprawnionego scrapingu, płatnych API, AI
czy automatycznych wiadomości. Nie kopiować galerii/dokumentów bez praw i kontroli.
Nie zbierać osób prywatnych ani upadłości konsumenckich.

## Przyszły model i przegląd

- Firma: kraj rejestracji + numer/ID źródłowy; wspólna deduplikacja z istniejącym
  kandydatem. Nie budować konkurencyjnej bazy CRM.
- Osobny lot: źródło + ID ogłoszenia/partii. Jedna firma może mieć wiele lotów;
  deduplikacja wyłącznie po firmie zgubiłaby różne oferty.
- Zdarzenie prawne: źródło + ID sprawy/ogłoszenia, data publikacji i aktualności.
  Osobne powiązanie z firmą i mandatem sprzedającego; bez kopiowania danych osób.
- Tylko pola występujące w źródle: towar, stan, liczba palet/sztuk, lokalizacja,
  cena/waluta, termin, ograniczenia, URL i czas. Brakujące pola pozostają puste.
- Dowód: konkretna referencja źródłowa i informacja, czy to deklaracja sprzedawcy,
  urzędowe zdarzenie czy wynik kwalifikacji towaru. Żadnego automatycznego verified.
- Ludzki przegląd: umocowanie i własność, autentyczność oferty, ilości, ważność,
  stan/opakowania, transport, dokumenty oraz ryzyka właściwe dla towaru.
- Wygaśnięcie/usunięcie ogłoszenia aktualizuje status; nie usuwa samowolnie
  historii ani przyszłych rekordów OWNER VAULT.

## Bramka przed implementacją

OWNER osobno zatwierdza źródła/warunki, dane i retencję, limity, sposób obsługi
ryzyka i dopiero potem adaptery. Testy obejmą duplikat lotu, kilka lotów tej samej
firmy, nieaktualne ogłoszenie, brak prawa sprzedaży, brak stanów/ilości, błędną
walutę oraz 429/awarie. Dane robocze pozostają prywatne; nie publikować tożsamości
dostawców Buyerom. Wszystkie wprowadzenia koordynuje ShadowBridge.

Nie używać sesji OWNER, tokenów administracyjnych ani poświadczeń PostgreSQL.
Mapowanie do istniejącego OWNER VAULT pozostaje projektowe; zapis maszynowy
wymaga odrębnego V3. Ta roadmapa nie uruchamia żadnej integracji.
