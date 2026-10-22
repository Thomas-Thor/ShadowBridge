# Contabo — aktualizacja bez poczty

Stan 22.10.2026: poprawka istniejącego instalatora, bazująca na `06a8b47`.
Nie ma dostępu SSH do `169.58.232.69`; publikacja na serwerze nie została wykonana.

## Jedna procedura

Na Contabo, w istniejącym repozytorium, z uprawnieniami administratora:

```sh
cd /opt/shadowbridge
sudo git pull --ff-only origin feature/secure-b2b-mvp
sudo npm run production:deploy -- --dir=.local/contabo-private --ipv4=169.58.232.69
```

Nie uruchamiaj `npm run demo`, nie twórz nowej konfiguracji i nie usuwaj blokady
poprzedniej operacji bez sprawdzenia, że jej proces już nie działa. Przy lokalnych
zmianach Git instalator zatrzyma się bez nadpisywania plików. Uruchomienie z tymi
uprawnieniami obsługuje również istniejący katalog `backups` należący do root;
nie wymaga udostępniania kluczy ani zmiany praw na publiczne.

Instalator nie pyta o Gmail/SMTP i nie zmienia DNS. Sprawdza, czy domena wskazuje
ten serwer. Zachowuje projekt Docker, PostgreSQL, konta, hasła, role, klucze i MFA.
Nowy profil jest tylko wersją konfiguracji **tej samej instalacji**, w
`.local/contabo-private/production-no-mail/<SHA>/`; poprzednie pliki pozostają.
Wskaźnik `selected.json` oznacza konfigurację przygotowaną, nie dowód wdrożenia.

Przed aktualizacją robi zaszyfrowany backup i uwierzytelnia archiwum oraz katalog
`pg_restore --list` na istniejącym PostgreSQL. **Nie tworzy dodatkowej bazy ani
środowiska i nie odtwarza niczego na bazie źródłowej.** Ta kontrola nie jest
pełnym testem odtworzenia. Następnie buduje obrazy, stosuje wyłącznie brakujące
śledzone migracje i porównuje zachowane dane. Rozpoznany stary publiczny Caddy
zatrzymuje dopiero po backupie i budowie; nie usuwa jego plików lub wolumenów.

## Co będzie aktywne

- Główna domena HTTPS bez tunelu i Basic Auth, istniejące strony oraz standardowe
  logowanie i MFA; istniejące uprawnienia w panelach, ofertach i RFQ.
- Formularz kontaktowy zapisujący zgłoszenia do kontrolowanej kolejki w bazie.
- Tymczasowo zamknięte rejestracja, linki potwierdzające oraz odzyskiwanie przez
  e-mail, także po bezpośrednim wywołaniu API. Formularze wyjaśniają niedostępność.
- GoTrue zachowuje logowanie e-mail/hasłem, lecz odmawia nowych rejestracji;
  SMTP nie ma danych dostępowych ani połączenia zewnętrznego.

Narzędzie wypisuje `ZWERYFIKOWANO` dopiero po kontroli domeny, SHA, backendu,
ochrony paneli i wyłączonych ścieżek e-mail. Osobna kontrola:
`sudo npm run production:verify -- --dir=.local/contabo-private`.
To nie zastępuje zalogowania istniejącego OWNER na prawdziwej domenie.

## OWNER bez Gmaila

Nie ma automatycznego resetu MFA. Jeżeli OWNER utracił samo hasło, uprawniony
operator po weryfikacji tożsamości może skorzystać z procedury
[owner-recovery.md](owner-recovery.md). Narzędzie robi backup, zmienia wyłącznie
hasło przez prywatne oficjalne API GoTrue, kończy sesje tego OWNER i zachowuje
dotychczasowe MFA. Zwykła aktualizacja nigdy go nie uruchamia.

## Checkpoint

Zachowano ukończone wyniki: konfiguracja profilu 15/15, runtime/UI 11/11,
narzędzie OWNER 4/4 (testy jednostkowe/granic kodu). Nowe testy instalatora 9/9.
Nie są to wyniki publikacji na VPS. Próba z prawdziwym lokalnym backendem dla
bieżącego trybu bez poczty i narzędzia OWNER pozostaje do wykonania w zachowanym,
fikcyjnym projekcie; nie wolno przedstawiać jej jako zaliczonej.

Historyczne wyniki z pocztą testową i pełnym odtworzeniem są osobno w
[CONTABO-PUBLIC-RESULTS.json](CONTABO-PUBLIC-RESULTS.json). Nie będą powtarzane.
