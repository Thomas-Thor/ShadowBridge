# ShadowBridge — plan zależności i backlog

Stan kodu: 22.10.2026, baza `7f794a2`, gałąź `feature/secure-b2b-mvp`.
To plan prac w repozytorium, nie potwierdzenie wdrożenia na Contabo.

## Audyt istniejących elementów

| Obszar | Stan faktyczny | Dalsza praca |
|---|---|---|
| Uwierzytelnianie, MFA, firmy | GoTrue, sesje BFF, CSRF, oddzielne Accounts/Applications, trwałe zgłoszenia, ręczne decyzje | Wykorzystać istniejący proces, nie tworzyć nowego logowania |
| Command Center | Siedem ról, RBAC/RLS, Overview, moduły pracowników i firm; `server/staff-management.mjs` | Nowe kafelki CRM wyłącznie dla OWNER, z osobnego API |
| Offers Workspace | Karty, szczegóły, filtry, paginacja i decyzje; `server/offers-workspace.mjs` | Zachować istniejące przepływy i uprawnienia |
| Kategorie / waluty | Kontrolowana taksonomia i podkategorie, administracja, walidacja, EUR/USD/GBP/NOK/PLN | Rozbudowywać istniejącą klasyfikację zamiast tworzyć drugą |
| Sentinel | Ukończony i przetestowany schemat H3-A, migracja 015 | H3-B–H3-E nie są wdrożonym agentem; zachować kolejność roadmapy |
| OWNER VAULT | Wcześniej tylko wymóg izolacji w dokumentacji; brak tabel/API CRM | Pierwszy etap: oddzielny schemat, API OWNER, audyt, bezpieczne przyjmowanie kontaktów i testy |
| C.A.R.T.E.L. | Publiczna strona informacyjna; `docs/cartel-network.md` opisuje przyszły model | Osobny prywatny Control Room; bez zmiany publicznej strony i bez dziedziczenia praw |
| Zdjęcia i PDF | Miejsca na materiały w UI; `docs/offer-materials.md` to specyfikacja, nie upload | Storage, kwarantanna, skaner, redakcja, zgoda odbiorcy i audyt muszą powstać przed aktywacją |
| Edytor strony / Umami / Luisa | Brak implementacji tych modułów | Osobne etapy po fundamentach VAULT, bez pozornej funkcjonalności |
| Poczta | Najnowszy profil produkcyjny bez SMTP blokuje rejestrację i odzyskiwanie przez e-mail | Nie uruchamiać komunikatów Luisy ani wysyłki bez zatwierdzonego SMTP |

Źródła wyników historycznych: `H2-C-REPORT.md`, `H3-A-REPORT.md`,
`CONTABO-NO-MAIL-RESULTS.json`. Nie zastępują testów nowych funkcji.

## Kolejność i zależności

1. **V1 — fundament OWNER VAULT (bieżący etap):** migracja 016, odrębne firmy i osoby,
   źródła/agent, statusy i prywatna historia; dostęp OWNER + MFA, ograniczony kontrakt
   przyjmowania danych, wieloetapowe rozpoznawanie duplikatów, API i testy izolacji.
   Bez importu istniejącego CRM Vincenta i bez prawdziwych kontaktów.
2. **V2 — prywatny interfejs i CRM Intelligence:** listy/szczegóły, filtry i edycja,
   kolejka niejednoznacznych rekordów; cztery klikalne kafelki z rzeczywistych danych.
   Definicja overnight: ostatni zakończony przedział 18:00–08:00 Europe/Oslo,
   uwzględniający zmianę czasu. API V1 przygotowuje tę samą definicję.
3. **V3 — kontrolowane n8n/Apollo/Clay:** osobny zapisujący principal na agenta,
   rotowane poświadczenia poza repo, limity i retry, idempotencja, audyt błędów
   bez surowych payloadów w logach. Żaden agent nie otrzymuje endpointów listowania,
   eksportu, danych wyników dopasowania ani dostępu do sesji/firm platformy.
   Przed aktywacją: zatwierdzić źródła, podstawę przetwarzania, retencję i koszty.
4. **C1 — C.A.R.T.E.L. OWNER Control Room:** osobne zaproszenia/członkostwa/przestrzenie,
   jednorazowe hashowane tokeny, wygaśnięcie/cofnięcie, ręczna decyzja i świeże MFA.
   OWNER może zarządzać; prawa członkowskie nigdy nie nadają praw staff lub VAULT.
   Kryteria członkostwa i okresy retencji wymagają decyzji OWNER.
5. **O1 — materiały ofert:** realizacja istniejącej specyfikacji `offer-materials.md`;
   oryginały prywatne, kwarantanna fail-closed, sprawdzenie formatu i malware,
   usuwanie metadanych/tożsamości, ręczne zatwierdzenie konkretnej kopii/hashu,
   przydział konkretnemu Buyerowi. Żadnych publicznych URL do źródeł.
6. **O2 — klasyfikacja:** zarządzanie istniejącymi kategoriami i podkategoriami;
   później Sentinel zapisuje sugestię z uzasadnieniem/wersją, nie zmienia sam
   opublikowanej oferty. Zatwierdza uprawniony człowiek, z audytem zmiany.
7. **W1 — edytor wizualny OWNER:** wersjonowany model bloków z listą dozwolonych
   typów i ograniczeń rozmiaru/położenia. Szkic → podgląd → zatwierdzona publikacja
   → rollback; kontrola współbieżności i świeże MFA przy publikacji. Renderer
   escapuje tekst, waliduje URL i media; bez dowolnego HTML/JS, skryptów, iframe,
   CSS lub dostępu do plików serwera. Nie modyfikuje logiki auth ani szablonów portalu.
8. **T1 — Traffic & Market Intelligence:** serwerowy adapter Umami, tylko agregaty
   krajów, źródeł, UTM, urządzeń/przeglądarek i potwierdzonych konwersji. Portal,
   CRM, tokeny, e-maile i dane formularzy wyłączone z analityki. Brak fikcyjnych
   liczników, oddzielne okresy/dedup konwersji i retencja. Przed uruchomieniem:
   decyzja o dostawcy, prywatności/cookies i kosztach; sekrety tylko serwerowo.
9. **S1 — dalszy Sentinel:** H3-B kolejka → H3-C rejestry → H3-D panel → H3-E analityka.
   Sygnały rynkowe mogą wykorzystywać zatwierdzone agregaty T1. Bez automatycznego
   dostępu do VAULT, ocen personalnych lub przyznawania dostępu.
10. **L1 — Luisa:** szkice komunikatów, powiadomienia wewnętrzne i zadania z
    imiennym zakresem uprawnień. Wiadomość zewnętrzna wymaga zatwierdzenia,
    aktywnego SMTP, idempotentnego outboxu i limitów. Brak autonomicznego
    przyznawania członkostwa, publikacji lub eksportu poufnych rekordów.

## Bramka każdego etapu

Implementacja → testy na fikcyjnych rekordach w izolacji → raport z granicami
testów → osobny commit na gałęzi rozwojowej → checkpoint. Brak zgody na
wdrożenie, zmiany Contabo, `main`, DNS, sekretów lub konta OWNER. Zmiany migracji
nie są stosowane do istniejącej lokalnej bazy właściciela. Utrzymanie/kopie
VAULT wymagają odrębnego ograniczenia dostępu i retencji przed publikacją.
