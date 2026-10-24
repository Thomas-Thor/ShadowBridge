# Jedno uruchomienie OWNER: API Book + odczyt n8n

25.10.2026, Europe/Oslo. **Nie wykonano aktualizacji Contabo, importu ani canary.**
Ponowny odczyt publicznych endpointów zatrzymało proxy CONNECT 403, również poza
sandboxem. Origin HTTP 000 nie dowodzi awarii aplikacji. Nie ma autoryzowanego SSH
ani narzędzi Apollo/Clay/n8n w katalogu tej sesji. OWNER zgłasza zainstalowane
wtyczki i udany odczyt profilu Apollo; nie jest to dowód uprawnień API n8n,
eksportu/search, bieżącego salda ani ceny operacji.

## Jedna czynność na lokalnym Pop!_OS

Uruchom sprawdzany SHA-256 `owner-next-step.mjs --apply` z pełnego SHA wskazanego
w raporcie. Potrzebne są dotychczasowe SSH/sudo i zweryfikowany klucz hosta oraz
Node >=22. Nie wklejaj sekretów do rozmowy. Nie uruchamiaj tego na VPS.

Launcher pobiera i sprawdza dwa **niezmienne** pliki:

- istniejący instalator R1 z `236e04bded81c406fb49ee0950ae20d139f257ec`;
- odczytową diagnostykę n8n z `d3e10071906e85911e9d5c5b74c4b7168027fba2`.

Najpierw istniejący instalator: preflight rzeczywistego R1 `d5582ff`, osobiste
potwierdzenie OWNER/TOTP, zaszyfrowane kopie DB/konfiguracji/certyfikatów,
zweryfikowana kopia poza VPS, wymiana samej aplikacji **bez migracji**, odbiór
lub rollback. STOP przy zmianie obrazu, fingerprintów, ledgeru, profilu, OWNER,
braku miejsca lub kopii. Nie zmienia kont, MFA, rekordów, n8n i jego workflow.
Krótka przerwa app/Auth/Caddy na backup pozostaje częścią zatwierdzanego okna.

Po poprawnym zakończeniu: publiczny HTTPS/release/odmowa bez klucza oraz odczyt
istniejącego n8n przez to samo SSH. Nieinteraktywny kolektor **nie pyta o klucz**;
brak uprawnień API pozostaje niepotwierdzony. Nie eksportuje credentials ani
treści workflow. Prywatny `result.json` i instalator pozostają w wypisanym katalogu
tymczasowym. Wynik JSON można przekazać do oceny bez kopiowania backupów i kluczy.
Zachowaj wskazany instalator do wyłączenia API; po restarcie komputera można go
ponownie pobrać z przypiętego wydania i sprawdzić sumę.

`bookAnonymousGateVerified:true` oznacza prawidłową odmowę **bez klucza**, a nie
potwierdzony autoryzowany odczyt czy połączenie ChatGPT. Pierwsze połączenie
ChatGPT ma użyć tylko READ ONLY, 1 dzień, minimalne `note.read` i ewentualnie
`summary.export` z odczytem odpowiednich rodzajów. Sekret tylko w zatwierdzonym
serwerowym magazynie Authentication. Zapis pozostaje zabroniony do oddzielnego
potwierdzenia. Save Strategy może później tworzyć notatkę; nie dodajemy drugiego
notatnika. MCP/OAuth/Plugin Creator w tym koncie nadal niepotwierdzone, bez
osadzania tokenu w Sites/JS i bez zmiany abonamentu. To nie blokuje pozyskiwania.

## Dlaczego nie uruchamiamy jeszcze canary

Gałąź pozyskiwania `d3e1007` pochodzi sprzed Command Book. **Nie wdrażać jej jako
aplikacji na R1:** zastąpiłaby nowsze funkcje. R1 `236e04b` nie zawiera jeszcze
`acquisition-gateway.mjs`. `crm-guard.sql` pozostaje kandydatem poza migracjami;
regionalne workflow nie są połączone z pamięcią CRM, źródła są puste, wszystkie
bramki i harmonogramy pozostają zamknięte. Historyczne testy PostgreSQL tej bramki
przeszły, ale nie dowodzą jej obecności na serwerze.

Następny automat musi potwierdzić prawa i koszt **konkretnego** bezpłatnego
odczytu/search Apollo lub istniejących danych Clay, mapowanie odpowiedzi i
ograniczony odbiorca centralnego CRM. Wtyczka ChatGPT nie przekazuje automatycznie
poświadczeń n8n. Nie używać sesji OWNER, klucza Command Book ani DBA do importu.
Brak CRM lub niejednoznaczność tożsamości blokują kosztowną operację.

Po potwierdzeniu tych faktów i zgodzie OWNER: jeden ręczny przebieg istniejącego
workflow, maksymalnie **5 nowych firm**, bez płatnego enrichment, kontaktów
osobowych, wysyłki i aktywacji harmonogramu. Sprawdzić ID/potwierdzenia w centralnym
CRM oraz powtórzyć tę samą partię: zero kolejnych nowych rekordów. Raport:
źródło, data, kraj/kategoria, nowe firmy/kontakty, duplikaty, błędy, czas,
odrębnie rzeczywisty koszt dostawcy albo `null` przy braku rozliczenia.
Limit 5 dotyczy pierwszego odbioru, nie zastępuje celu 1000/noc.

## Klasyfikacja odbioru canary

To wymagany kontrakt odbioru, **nie aktywna klasyfikacja CRM**. Obecny normalizer
odróżnia firmę, osobę i ogłoszenie BUY/SELL/SURPLUS; nie dopisano fikcyjnych pól
do nieuzgodnionego kontraktu odbiorcy.

| Etykieta | Minimalne uzasadnienie |
|---|---|
| LEAD | firma/profil źródłowy, `unconfirmed`; brak domniemanych nadwyżek |
| SELLER | udokumentowana rola sprzedającego; nie dowodzi dostępnego towaru |
| BUYER | źródłowy sygnał potrzeby zakupu; nie zgadywać po branży |
| LOCAL SCOUT | kandydat do lokalnej współpracy; dopiero po przeglądzie człowieka |
| STOCK SIGNAL | konkretne ogłoszenie/źródło towaru, data, `review_required` |
| VERIFIED DEAL | dowód towaru, dostępności, warunków i uprawnienia do sprzedaży, decyzja człowieka; nigdy sam profil Apollo |

Źródło rejestrowe potwierdzające istnienie firmy nie potwierdza transakcji.
Nie łączyć tych etykiet ze statusem weryfikacji tożsamości lub automatycznym
zatwierdzeniem konta. Nie zmieniać Relevance, pilota NO/CZ ani aktywnych agentów.

## Testy i granice

Nowe testy dotyczą wyłącznie launchera: przypięcie Git/SHA, odmowa podmienionych
skryptów, składnia komendy SSH, HTML dla signin/JSON dla health, redakcja raportu,
nieutożsamianie 401 z dostępem oraz bezpieczny dry run. HTTP/SSH używają fikstur;
to **nie** test Contabo, API Apollo/Clay, importu n8n lub rzeczywistego CRM.
Wcześniejsze wyniki backendu: [integration-results.json](integration-results.json),
a API Book: dokumentacja w przypiętym wydaniu R1. Nie powtarzano ich bez zmian.
