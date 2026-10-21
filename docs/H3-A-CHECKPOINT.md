# H3-A — checkpoint przygotowania

To zapis częściowej pracy, **nie potwierdzenie ukończenia H3-A**.

Gotowe: roadmapa H3-A–H3-E, z odrębnym Member Intelligence po H3-D, oraz skrypt
przygotowania izolowanego środowiska testowego. Wykonano 3 grupy przygotowania
bazy 001–014: rzeczywiste potwierdzenie e-maila i MFA fikcyjnego OWNER, konta
zatwierdzone/oczekujące i dwóch członków jednej firmy, siedem ról pracowniczych
z MFA. To przygotowanie danych, nie testy migracji Sentinel.

Nie ma jeszcze migracji 015 ani wdrożonych funkcji Sentinel. Nie uruchomiono
H3-B, H3-C, H3-D lub H3-E, rejestrów zewnętrznych ani modeli AI. Nie zmieniono
Contabo, konta OWNER Vincent, OWNER VAULT, produkcji, `main` lub DNS.

Ustalony minimalny model do implementacji: osobne `company_verifications`,
`verification_cases`, dopisywane `verification_checks` i `verification_case_events`;
status firmy i wynik istnienia w rejestrze niezależne od członkostwa użytkownika.
Historia będzie wskazywać firmę, źródłową aplikację oraz wykonawcę i czas
operacji, bez wdrażania analityki H3-E. Nowy proces kontroli otrzyma rolę
`NOLOGIN`, bez dostępu do Auth, sesji, uprawnień, poufnego CRM lub danych Vault.

Następne prace w obrębie H3-A: ukończyć SQL, testy migracji/zachowania danych,
RLS, relacji firma–osoba i niezmienności historii; dopiero potem raport końcowy.
Proces testowy przerwał limit użycia po przygotowaniu bazy. Wygenerowane sekrety
fikcyjnej instalacji mają prawa 0600 w `.local/` i nie są częścią repozytorium.
