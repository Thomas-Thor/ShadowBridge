# H2-C — kontrola migracji przed trwałym zastosowaniem

Stan przygotowania: **013 i 014 sprawdzone w izolowanej transakcji wycofanej
przez ROLLBACK; nie zastosowano ich do istniejącej instalacji właściciela ani
Contabo**. Ten checkpoint zapisuje SQL przed uruchomieniem nowej instalacji
testowej. Nie jest poleceniem aktualizacji serwera.

- `013_recruitment_visibility`: recenzenci z `applications.read` oraz
  `counterparties.read` widzą konto i profil przypisane do ocenianego wniosku.
  Nie otrzymują dodatkowego prawa zapisu ani dostępu do Auth/sekretów.
- `014_application_decision_history`: historia decyzji tylko do dopisywania;
  najnowsza zachowana decyzja starszego wniosku jest oznaczona `legacy_snapshot`.
  Nieznane wcześniejsze daty i osoby pozostają nieznane. Istniejące konta,
  członkostwa i funkcja podejmowania decyzji pozostają bez zmian.

Rzeczywiste testy PostgreSQL na fikcyjnym fixture H2-B:

- **013: 9 grup PASS** — siedem ról pracowniczych, izolacja Buyer/Supplier/Partner,
  odmowa recenzentowi bez MFA.
- **014: 5 grup PASS** — zachowanie oryginalnego starszego uzasadnienia/nulli,
  dopisanie nowej decyzji i audytu przez istniejący RPC, odczyt recenzentów,
  brak wewnętrznej historii dla członków, odmowa modyfikowania historii.
- Przed próbami zapisano prywatny backup fikcyjnej bazy. Po ROLLBACK fingerprinty
  danych Auth, haseł, sesji, MFA, kont, uprawnień, aplikacji, profili i polityk
  pozostały identyczne; ledger nadal zawiera **001–012**. PostgreSQL fixture
  ponownie zatrzymano. Nie wykonywano resetów ani usuwania wolumenów.
- Kontrola loadera migracji, checksum i połączeń: **7/7 PASS**. To osobne testy
  źródeł/konfiguracji, nie dowód działania API.

Wyniki lokalne: `/tmp/shadowbridge-h2c-policy-rollback.json` oraz
`/tmp/shadowbridge-h2c-history-rollback.json`. Sekrety, backupy i surowe dane
testowe nie są częścią commita.

Następne kroki H2-C: rzeczywista regresja API i przeglądarki na nowej, izolowanej
instalacji z zapisanymi migracjami, następnie regresja H2-A i H2-B. Ostateczny
raport musi odróżniać te wyniki od powyższych prób SQL. **H3-A nie rozpoczęto.**
