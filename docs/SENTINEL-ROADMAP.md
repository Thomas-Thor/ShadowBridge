# ShadowBridge Sentinel — roadmapa H3-A–H3-E

Stan: zakres zatwierdzony przez właściciela 21.10.2026; ukończono wyłącznie
**H3-A**, zgodnie z [raportem i wynikami testów](H3-A-REPORT.md).
H3-B–H3-E pozostają nierozpoczęte. Wyniki danego etapu podaje jego osobny raport.
Ten dokument nie potwierdza działania przyszłych integracji ani analityki.

| Etap | Zakres | Granica etapu |
|---|---|---|
| **H3-A — model weryfikacji** | Schemat PostgreSQL, statusy spraw i weryfikacji firmy, wyniki kontroli, historia, RLS i audyt. | Bez kolejki wykonawczej, reguł automatycznych, połączeń z rejestrami i nowego panelu. |
| **H3-B — zadania i reguły podstawowe** | Trwała kolejka zadań, idempotencja, limity, ponowienia, podstawowe reguły jakości zgłoszeń, duplikaty i rozbieżności. | Bez rozbudowanej analityki członków i oceny ich efektywności. |
| **H3-C — rejestry urzędowe** | Adaptery zależne od kraju, początkowo Brønnøysundregistrene w Norwegii; udokumentowane wyniki i obsługa niedostępności. | Wynik istnienia firmy nie przyznaje członkostwa, reprezentacji ani dostępu do ofert. |
| **H3-D — panel Sentinel** | Uprawniony widok Command Center, kolejka spraw, źródła, raporty, wyjaśnienia i decyzje menedżerów. | Istotne decyzje pozostają pod kontrolą człowieka, z MFA i audytem. |
| **H3-E — Member Intelligence & Security Analytics** | Oddzielne analizy działalności firm i osób, zdarzenia bezpieczeństwa, alerty oraz raporty współpracy. | Osobny etap po H3-D; nie jest częścią H3-B ani bieżącego H3-A. |

Każdy etap obejmuje implementację, adekwatne testy, osobny commit, raport oraz
zatrzymanie na punkcie kontrolnym. Kolejny etap rozpoczyna się po ukończeniu
poprzedniego, zgodnie z poleceniem właściciela. Nie wdrażamy automatycznie na
Contabo, nie zmieniamy konta OWNER, produkcji, `main`, DNS ani hostingu.

**Stałe granice bezpieczeństwa**

- Potwierdzenie e-maila jest obowiązkowe. Normalna kolejka Applications otrzymuje
  zgłoszenie po potwierdzeniu; dane pierwszego formularza pozostają trwale
  powiązane z kandydatem niezależnie od przeglądarki.
- Oddzielamy: istnienie przedsiębiorstwa w rejestrze, prawo osoby do reprezentacji,
  kwalifikację dostawcy/towaru oraz członkostwo użytkownika. Kontrola rejestrowa
  może zapisać udokumentowany wynik automatycznie; nie zatwierdza konta ani nie
  ujawnia poufnych okazji. Nie zmienia też istniejących aktywnych kont.
- Dostęp do spraw i dowodów wymaga odpowiednich uprawnień API i PostgreSQL RLS.
  Proces kontroli otrzymuje wyłącznie minimalne kompetencje; nie nadaje ról ani
  członkostwa i nie zawiesza samodzielnie użytkowników. Błędy rejestru są stanem
  wymagającym dalszego sprawdzenia, a nie dowodem oszustwa.
- **OWNER VAULT jest odrębną strefą.** Prywatny strategiczny CRM Vincenta nie jest
  importowany, indeksowany, łączony z raportami ani udostępniany pracownikom,
  partnerom lub Sentinelowi. Ewentualny dostęp wymaga osobnego procesu i decyzji.
- Dane wrażliwe nie trafiają do zewnętrznych modeli bez osobnej decyzji właściciela
  dotyczącej prywatności, zakresu danych i dostawcy. Etap H3-A nie wymaga LLM.

**Zgodność modelu H3-A z przyszłym H3-E**

Historia przedsiębiorstwa używa stabilnego `company_id`. Tożsamość konta,
reprezentującego członka i wykonującego operację pracownika pozostaje odrębna:
relacja członkostwa łączy `user_id` i firmę. Jedna firma może mieć wiele kont;
zbieżny numer firmy jest sygnałem do przeglądu, a nie automatyczną blokadą lub
podstawą do połączenia kont. H3-A nie scala samodzielnie istniejących firm.

Kontrole i historia zachowują powiązanie ze sprawą, źródłem, wykonawcą, czasem
zdarzenia i jego zapisu oraz wersją zastosowanej procedury. Oddzielają fakt
zewnętrzny od decyzji menedżera. H3-A przygotowuje takie odniesienia; nie tworzy
kolektorów aktywności, profili behawioralnych ani tabel analityki H3-E.

**Szczegółowy zakres H3-E — dopiero po H3-D**

1. **Company vs Individual:** osobne osie historii firmy i konta osoby, z
   członkostwem i zakresem dostępu. Zachowanie jednej osoby nie jest automatycznie
   przypisywane wszystkim pracownikom tej firmy.
2. **Business Activity:** uporządkowane zdarzenia aplikacji, ofert, RFQ, projektów,
   zatwierdzeń, współpracy i uzgodnionych prowizji. Kontrakty i wyniki handlowe
   pojawiają się wyłącznie po istnieniu rzeczywistego, autoryzowanego źródła tych
   danych; obecne projekty nie są przedstawiane jako zrealizowane kontrakty.
3. **Security Events:** serwerowe zdarzenia logowania, nieudanych uwierzytelnień,
   odmów dostępu i eksportów. Osobno można odnotować użycie jawnego przycisku
   kopiowania udostępnionych danych w aplikacji. Taki sygnał przeglądarkowy nie
   dowodzi wszystkich operacji kopiowania; nie gwarantuje zapobiegania kopiowaniu.
4. **Security Alerts:** kontekstowe reguły, progi, deduplikacja, czasowe wyciszenie
   i uzasadnione zamykanie fałszywych alarmów. Incydent trafia do uprawnionego
   menedżera; zapisywane są źródła, niepewność, przegląd i decyzja.
5. **Partner Performance:** odrębny raport aktywnych projektów, zgłoszeń, wyników,
   udokumentowanych kontraktów i indywidualnie uzgodnionych prowizji. Metryki
   efektywności i bezpieczeństwa mają osobne widoki i uprawnienia; nie powstaje
   wspólny ranking „wartości” lub „wiarygodności” osoby.
6. **Human Review:** analiza, w tym ewentualna AI, przedstawia fakty, źródła,
   ograniczenia i zalecenia. Zwykłe przeglądanie dozwolonych danych nie jest
   kwalifikowane jako szpiegostwo. Poważne decyzje personalne oraz istotne
   ograniczenia dostępu i blokady wymagają ludzkiej autoryzacji oraz audytu.
7. **Privacy & Security:** zbieramy minimalne metadane niezbędne do określonego
   celu. Nie przechwytujemy haseł, tokenów, prywatnego schowka ani aktywności poza
   platformą. Nie kopiujemy domyślnie treści ofert, dokumentów i korespondencji
   do logów. Przed uruchomieniem zbierania zatwierdzamy transparentną politykę
   monitorowania, okresy retencji i zasady usuwania; ewentualne zachowanie dowodu
   incydentu ma określony powód i zakres. Wgląd oraz eksport raportów są audytowane,
   a uprawnienia ponownie sprawdzane w API i PostgreSQL.

**Bramki jakości**

H3-A wymaga testów migracji na izolowanej bazie, zachowania istniejących kont,
sesji i MFA, relacji firma–konto, RLS, uprawnień oraz niezmienności historii.
Nie oznacza to przetestowania działającego urzędowego rejestru.

H3-C obejmie testy firmy nieistniejącej, błędnego numeru, firmy istniejącej
zgłoszonej przez osobę bez prawa reprezentacji, niedostępności rejestru oraz wielu
kont tej samej firmy. Kontrolowane odpowiedzi testowe muszą być odróżnione od
rzeczywistych wywołań rejestru. H3-E doda testy fałszywych alarmów, retencji,
izolacji raportów, audytu odczytu i wyłączenia OWNER VAULT. Te scenariusze są
**zaplanowane**, nie są obecnym wynikiem PASS.
