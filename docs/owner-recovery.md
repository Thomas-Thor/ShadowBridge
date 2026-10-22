# Odzyskanie dostępu OWNER

Ta procedura jest przeznaczona dla właściciela i wyznaczonego operatora infrastruktury. Nie jest publicznym mechanizmem odzyskiwania uprawnień. Director, Manager, Staff i członek C.A.R.T.E.L. nie mogą jej uruchomić przez API.

1. **Utrata hasła OWNER:** sam link e-mail nie wystarcza do zmiany metody uwierzytelniania najwyższego konta. Samodzielny reset hasła OWNER jest w MVP zablokowany po stronie serwera (`owner_recovery_controlled`). Właściciel z działającym authenticatorem kontaktuje się z wyznaczonym operatorem infrastruktury; operator potwierdza tożsamość poza aplikacją oraz aktualny drugi składnik, rejestruje incydent i korzysta wyłącznie ze sprawdzonego administracyjnego mechanizmu dostawcy Auth. Nie ma formularza przyjmującego identyfikator innego użytkownika ani publicznego obejścia. Zwykłe konta Buyer/Supplier/Partner zachowują reset po potwierdzeniu e-maila.
2. **Utrata authenticatora:** wstrzymaj wrażliwe operacje. Operator potwierdza tożsamość właściciela poza aplikacją, co najmniej dwoma niezależnymi kanałami, oraz posiadanie dostępu do infrastruktury. Same wiadomość e-mail, numer telefonu albo deklaracja managera nie wystarczają. Nie przesyłaj sekretu TOTP ani haseł przez e-mail.
3. Operator zapisuje numer incydentu, wykonuje zaszyfrowaną kopię bazy i dzienników, unieważnia sesje BFF **oraz sesje dostawcy Auth** tego konta. Dopiero potem usuwa utracony czynnik oficjalnym administracyjnym mechanizmem wybranego Auth. Zewnętrzna procedura dostawcy wymaga osobnego sprawdzenia przed staging; nie dodano skrótu usuwającego MFA w aplikacji ani bezpośredniej edycji tabel Auth.
4. Operator przeprowadza kontrolowaną zmianę hasła oficjalnym mechanizmem dostawcy Auth; właściciel rejestruje nowy authenticator i potwierdza rzeczywisty kod. Do tego czasu API nie udostępnia operacji zarządczych wymagających `aal2`. Operator sprawdza audyt, aktywne role i sesje; kończy incydent dopiero po próbie logowania oraz odmowie działania starej sesji.
5. **Utrata uprawnienia OWNER albo całego konta:** wyłącznie operator DBA może wywołać `sb.bootstrap_owner` dla istniejącego, aktywnego i potwierdzonego konta po tej samej zewnętrznej weryfikacji. Lokalny odpowiednik to `npm run bootstrap:admin -- --email=ZWERYFIKOWANY_ADRES --grant-owner`, wykonywany przez operatora ze sprawdzoną konfiguracją lokalnej bazy, a nie przez zwykłego użytkownika. Operacja jest audytowana, nie tworzy hasła, nie wyłącza MFA i nie jest dostępna rolom API/sesji. Nie wolno automatycznie promować wszystkich dawnych `staff_grants`.

Przed użyciem na rzeczywistych danych trzeba uzgodnić osobę upoważnioną do odzyskania, bezpieczny dostęp do infrastruktury i kluczy backupu oraz przećwiczyć tę procedurę na osobnym koncie testowym. Obecnie nie ma publicznego formularza odzyskiwania roli OWNER ani automatycznego obejścia MFA.

## Odzyskanie samego hasła bez SMTP

W trybie bez wysyłki poczty publiczne odzyskiwanie hasła jest wyłączone. Dla
istniejącego OWNER przygotowano wyłącznie narzędzie operatora infrastruktury:

```sh
node scripts/owner-password-recovery.mjs --dir=.local/contabo-private --email=DOTYCHCZASOWY_ADRES_OWNER --incident=INC-2026-000001
```

Uruchom na serwerze, w istniejącym repozytorium, z uprawnieniami do jego prywatnej
konfiguracji i Dockera, po niezależnym potwierdzeniu tożsamości i zapisaniu
incydentu. Nowe hasło wpisuje się dwukrotnie w ukrytym pytaniu; nie podaje się go
w poleceniu, pliku, zmiennej środowiskowej lub czacie.

Narzędzie odmawia działania dla niepotwierdzonego, nieaktywnego albo innego niż
OWNER konta oraz przy braku istniejącego potwierdzonego czynnika TOTP. Przed
zmianą wykonuje zaszyfrowany backup. Korzysta z oficjalnego, prywatnego API GoTrue
do zmiany **wyłącznie hasła**, a następnie kończy sesje BFF tego OWNER. GoTrue
kończy jego sesje dostawcy i tokeny odświeżania. Sprawdzane są niezmienione role,
potwierdzenie adresu i zapisy MFA; rozpoczęcie, wynik i błąd trafiają do audytu.

To administracyjna procedura awaryjna, nie publiczny sposób logowania i nie
automatyczna weryfikacja kodu TOTP. Po zmianie trzeba normalnie się zalogować
nowym hasłem i **dotychczasowym MFA**. Narzędzie nie usuwa, nie podmienia ani nie
zakłada czynnika MFA. Utrata authenticatora wymaga odrębnej, kontrolowanej
procedury opisanej powyżej; ta komenda nie rozwiązuje takiej utraty.

Testy `tests/owner-password-recovery.test.mjs` sprawdzają payload, krótki JWT i
granice kodu; same nie potwierdzają wykonania zmiany na działającym GoTrue.
22.10.2026 wykonano również rzeczywistą próbę na zachowanym fikcyjnym OWNER:
oficjalny GoTrue zmienił hasło bez poczty, stare hasło i sesje OWNER przestały
działać, sesja innej firmy pozostała aktywna, a nowe logowanie do Command Center
wymagało tego samego TOTP. Nie zmieniono rzeczywistego OWNER na Contabo.
Wynik: [CONTABO-NO-MAIL-RESULTS.json](CONTABO-NO-MAIL-RESULTS.json).
Nie uruchamiaj narzędzia przy zwykłej aktualizacji lub gdy OWNER może się zalogować.
