# Pakiet Contabo — punkty kontrolne

Punkt wyjścia: `c3c32a640e2a3dbf007c12d4415031d72832134b` na
`feature/secure-b2b-mvp`. Prace wyłącznie w repozytorium i środowisku lokalnym.
Nie logowano się na VPS; nie zmieniano main, domeny ani DNS.

## G1 — audyt i uzupełnienie pakietu

HEAD był zgodny z podanym punktem wyjścia, katalog roboczy czysty. Nie znaleziono
zakończonego raportu ani commita etapu F. Istnieje zatrzymany, oddzielny projekt
testowy F; nie uruchamiano go ponownie i nie usuwano jego wolumenu. Wynik A–E
11/11 dotyczy prezentacji z fikcyjnymi DTO, nie integracji nowych dashboardów.
Historyczna rzeczywista regresja sprzed A–E pozostaje opisana osobno.

Szkic `deploy/staging/` odwoływał się do nieistniejących generatora i migratora.
Uzupełniono przygotowanie prywatnej konfiguracji, PKI i sekretów oraz migrator
z kontrolą historii i sum plików. Compose publikuje wyłącznie lokalny port HTTPS;
PostgreSQL, GoTrue, Mailpit i API nie mają portów hosta. Brama wymaga dodatkowego
hasła testera. Nie używa się `npm run demo` ani lokalnych kont właściciela.

Naprawiono odczyt hasła bramy bez końcowego znaku nowej linii: Caddy CLI zwracał
EOF. Hasło nadal jest podawane przez stdin, bez argumentów procesu i logowania.
Migracje i nowe loginy nie są wykonywane podczas samego przygotowania plików.

Kontrole G1: generator **6/6**, migrator **7/7** (jednostkowe, bez bazy),
rzeczywiste przygotowanie nowego katalogu testowego oraz ponowna weryfikacja,
`docker compose config --quiet`, składnia Node/shell i `git diff --check` — PASS.
Są to kontrole pakietu, nie testy integracji. Początkowy błąd jednej fikstury
testu URL poprawiono; końcowy komplet migratora 7/7 zaliczony.

Wyniki kolejnych kontroli zostaną dopisane po rzeczywistym wykonaniu.
Pakiet nie jest jeszcze deklaracją gotowości do obsługi rzeczywistych firm.
