# Prywatny pakiet instalacyjny Contabo

Pakiet jest przygotowywany i sprawdzany lokalnie. Nie wykonuje publikacji,
zmian DNS ani połączeń SSH. [Stan weryfikacji](../../docs/contabo-package-status.md)
odróżnia zakończone kontrole od nieprzetestowanych elementów.

`npm run staging:prepare` tworzy nowy zestaw sekretów i certyfikatów w ignorowanym
katalogu `.local/`. `npm run staging:check` sprawdza konfigurację bez uruchamiania
kontenerów. Istniejąca konfiguracja nie jest automatycznie nadpisywana.

Jedynym opublikowanym portem jest HTTPS na loopback. Do zdalnych prób potrzebny
jest tunel SSH oraz zaufanie do konkretnego prywatnego certyfikatu. PostgreSQL,
GoTrue, Mailpit i aplikacja pozostają na prywatnej sieci Dockera.
Nie przenoś lokalnych kont, `.local/development.env` ani `demo-accounts.json`.
Nie uruchamiaj `npm run demo` jako usługi internetowej.
