# Apollo, Clay, n8n: wspólna pamięć i ochrona kredytów

24.10.2026. **Przygotowano kod i testy lokalne. Nie podłączono rzeczywistych kont i nie aktywowano automatyzacji.** Nie utworzono kont, nie kupiono pakietów i nie wykonano płatnego wywołania.

## Dostępność i warunki: co rzeczywiście sprawdzono

Nie ma w tej sesji kluczy, konektora n8n ani SSH. Ponowione odczyty dokumentacji Apollo, Clay i health istniejącego n8n są blokowane przez proxy: CONNECT 403, origin HTTP 000, również poza sandboxem. Nie jest to dowód niedostępności Contabo.

| System | Potwierdzone | Nadal niepotwierdzone |
|---|---|---|
| Istniejący n8n | przygotowano import przez publiczne API, bez drugiej instalacji | rzeczywiste uprawnienia API i import na tej instancji |
| Apollo | przygotowano osobne poświadczenie HTTP, bez wysyłania zapytań do dostawcy | plan, search API, uprawnienia klucza, limit, koszt i aktualny format wyników |
| Clay | przygotowano osobne poświadczenie; można pominąć bez błędu instalatora | dostęp API w posiadanym planie, endpoint/format odczytu wyników, nagłówek autoryzacji i koszt |
| Centralny CRM | kod używa istniejącego `owner_vault`, przetestowano z PostgreSQL | wdrożenie kandydata i utworzenie ograniczonych powiązań maszynowych |

Dokumentacje do potwierdzenia po uzyskaniu dostępu: [Apollo Search](https://docs.apollo.io/reference/people-api-search), [Apollo Usage](https://docs.apollo.io/reference/view-api-usage-stats), [Clay HTTP integration](https://university.clay.com/docs/http-api-integration), [n8n API](https://docs.n8n.io/api/). Samo konto Apollo/Clay lub działający klucz nie dowodzi darmowego API. Integracja HTTP w Clay nie oznacza automatycznie prawa do eksportu jego tabel. Jeżeli opłacony plan nie udostępnia właściwego API, adapter pozostaje wyłączony; bez zakupu/upgrade i bez obejścia ograniczeń.

Nie znamy sald ani aktualnych stawek. Nie podajemy fikcyjnego kosztu miesięcznego. Domyślnie płatne operacje są wyłączone, polityki puste, bez zgody nie można zarezerwować kredytów. Kwoty pieniężne i rzeczywiste kredyty w raporcie pozostają `null`, dopóki rozliczenie dostawcy nie zostanie odczytane i uzgodnione. Kredytów Apollo i Clay nie należy sumować jako jednej waluty.

## Co przygotowano bez poświadczeń

- `server/acquisition-gateway.mjs`: bramka w istniejącej aplikacji pod `/api/integrations/acquisition/v1/`, domyślnie HTTP 503. Oddzielne hashowane klucze maszynowe per dostawca; nie akceptuje cookies, sesji OWNER ani wywołań z przeglądarki. Nie zwraca prywatnych rekordów lub identyfikatorów CRM, wyłącznie decyzje, losowe potwierdzenia i agregaty własnego zakresu.
- `crm-guard.sql`: **kandydat poza automatycznymi migracjami**. Używa tabel istniejącego OWNER VAULT dla firm, osób i historii, zamiast drugiej bazy kontaktów. Dodaje techniczne aliasy identyfikatorów, historię zapytań, rezerwacje kosztu i blokady pól. Nie tworzy loginów, haseł, OWNER, grantów do list CRM ani automatycznego zatwierdzenia kontrahenta. Wymaga osobnej zgody na zastosowanie.
- `credit-guard.mjs`: najpierw zapis bezpłatnie posiadanych faktów, potem kontrola CRM, rezerwacja limitu, druga kontrola i jednokrotne dopuszczenie wywołania. Fakty z historii CRM, także oczekujące na kontrolowane scalenie, nie są kupowane ponownie. Brak CRM, nieznany koszt lub niejednoznaczna tożsamość powodują odroczenie, bez płatnej operacji.
- `crm-guard-apollo.json` i `crm-guard-clay.json`: współdzielone podworkflow zapisujące dane bezpłatne i sprawdzające CRM, oba nieaktywne i z zamkniętą bramką. To komponenty istniejących przepływów, nie nowe piloty krajowe. Nie zawierają węzłów płatnego odsłaniania, enrichment, wysyłki lub uruchamiania agentów.
- `authorize-n8n.mjs`: jednorazowa autoryzacja i import nieaktywny przez istniejące n8n, bez paczek npm, nowych kont i instalacji serwera. Trwały prywatny checkpoint zawiera wyłącznie identyfikatory/statusy. Ponowne uruchomienie nie powtarza zakończonych POST. Niepewna odpowiedź po zapisie zatrzymuje pracę zamiast tworzyć duplikat.
- `/usage`: przygotowane liczniki nowych firm/osób, zapobieżonych duplikatów, przeglądów, rezerwacji i niepewnych zakupów. Dane do raportu OWNER są oddzielone od samych rekordów.

## Reguły deduplikacji i kosztu

Firma: kraj + numer rejestrowy albo wcześniej powiązany stabilny identyfikator źródłowy. Domena/nazwa są sygnałem kandydackim, nie podstawą automatycznego scalenia grupy spółek. Różne numery rejestrowe pozostają odrębne, nawet przy podobnej nazwie lub wspólnej domenie.

Osoba: identyfikator źródła, zawodowy profil lub indywidualny e-mail w rozpoznanej firmie. Dokładna kombinacja imienia/nazwiska i firmy bez silnego identyfikatora trafia do przeglądu; podobne nazwisko nie scala osób. Wspólny `info@` nie jest kluczem osoby. Konflikt silnych identyfikatorów blokuje płatność.

Rezerwacja kosztu i blokada brakującego pola są wspólne dla źródeł. Dotyczą tożsamości, nie pary dostawca + rekord. Ta sama osoba nie otrzymuje nowej puli po zmianie Apollo na Clay, po uzyskaniu CRM ID, po restarcie lub kolejnego dnia. Dane już dostępne usuwa się z listy wymaganych pól przed wywołaniem.

Polityki wymagają zatwierdzonej operacji, maksymalnego kosztu jednostkowego, dziennego i miesięcznego limitu oraz znanego salda zweryfikowanego w ostatnich 24 h. Rezerwacje obejmują wszystkie operacje danego konta, również niepewne. Nie ma funkcji kupowania kredytów. Dane z firm pozostają `unconfirmed` albo trafiają do kontroli, nie stają się zweryfikowane po samym imporcie.

Pamięć zapytań obejmuje dostawcę, kraj, sektor, źródło, faktyczne filtry i ich wersję. Kursory pozostają między sesjami i dniami. Wyczerpana identyczna partycja nie zaczyna ponownie od strony 1. Nowe wyszukiwanie wymaga rzeczywiście nowego zakresu albo zatwierdzonego filtra aktualizacji, nie losowego identyfikatora/datownika służącego omijaniu pamięci.

Przy timeout po wysłaniu żądania nie da się dowieść, że dostawca nie pobrał kredytu. Dlatego nie obiecujemy matematycznego exactly-once bez udokumentowanej idempotencji dostawcy. System nie ponawia takiego zakupu automatycznie; zachowuje blokadę do sprawdzenia rozliczenia. Brak wyniku nie jest traktowany jako darmowa operacja.

Klucze umożliwiające płatne zakupy nie mogą być dostępne jako dowolne narzędzie agenta. Odczyt/search wymaga ograniczonego klucza lub zatwierdzonego brokera, jeśli dostawca nie pozwala zawęzić API. Przyszły płatny adapter musi mieć zweryfikowany kontrakt konkretnej operacji, korzystać z tej bramki i dostać oddzielną zgodę OWNER. W tym pakiecie nie ma aktywnego adaptera płatnego Apollo/Clay.

## Jednorazowa autoryzacja OWNER, bez długiej konfiguracji

Potrzebne są tylko uprawnienia do już istniejących systemów:

1. Tymczasowy klucz API istniejącego n8n pozwalający odczytać workflow, utworzyć poświadczenia i zaimportować nieaktywny workflow. Nie potrzebujemy wykonywania/aktywowania workflow. Jeśli plan nie pozwala ograniczyć zakresów, użyj krótkotrwałego klucza uprawnionego operatora i odwołaj go po imporcie.
2. Klucz istniejącego Apollo ograniczony do dozwolonego odczytu/search. Jeśli nie ma takiego zakresu lub dostęp wymaga zakupu, pomiń pole.
3. Klucz istniejącego Clay wyłącznie jeśli obecny plan daje dozwolony odczyt danych. Jeśli nie daje, pomiń pole. Nie wybieraj nowego abonamentu.

**Nie przesyłaj żadnego klucza w rozmowie, e-mailu ani repozytorium.** Jedyną czynnością terminalową jest poniższy blok na Contabo jako `shadowadmin`, w prywatnej sesji. Instalator pyta o klucze w ukrytym wejściu, używa istniejącego HTTPS i zapisuje poświadczenia w istniejącym n8n. Nie zmienia DNS, aplikacji, bazy CRM ani aktywnych workflow. Nie trzeba edytować plików. Brak klucza Apollo/Clay można potwierdzić Enterem.

```bash
AUTH_DIR=$(mktemp -d /tmp/shadowbridge-authorize.XXXXXX) &&
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/feature/nightly-global-acquisition/automation/nightly-global/authorize-n8n.mjs' \
  -o "$AUTH_DIR/authorize-n8n.mjs" &&
printf '%s  %s\n' '7ac7398d49d34c5c5308c92bd38f7d618802eb3ff145df94f8c6061df10b2370' \
  "$AUTH_DIR/authorize-n8n.mjs" | sha256sum -c - &&
node "$AUTH_DIR/authorize-n8n.mjs" --apply
```

Oczekiwany rezultat: JSON z `IMPORTED_INACTIVE_NOT_CONNECTED_TO_PROVIDERS`, 0 kosztownych wywołań i 0 zmienionych aktywnych workflow. Klucze wprowadzone do n8n nie są dowodem dostępu do API ani kosztu odczytu. Dla Clay nagłówek/kontrakt trzeba potwierdzić przed podłączeniem źródła. Zwróć wyłącznie JSON, bez sekretów i prywatnego checkpointu. Ctrl+C przerywa bez aktywacji; checkpoint nie pozwoli automatycznie powtórzyć niepewnego zapisu. Cztery bazowe JSON są pobierane z ustalonego `04ab380`, dwa współdzielone guardy budowane lokalnie z tego sprawdzanego sumą skryptu.

Ta autoryzacja nie otwiera tej sesji Codexa bezpośredniego SSH ani dostępu przez blokujący proxy. Skrypt wykonuje dozwoloną konfigurację lokalnie za operatora. Dalsza automatyczna konfiguracja wymaga autoryzowanego kanału do istniejącej instancji, bez przekazywania sekretów w czacie. Nie będziemy twierdzić, że samo utworzenie credentials oznacza uruchomione pozyskiwanie.

## Co pozostaje po autoryzacji, do wykonania przez automat/Codexa

- Odczyt faktycznych praw, limitów, sald i kontraktów API; preferowany odczyt już opłaconych wyników, bez enrichment i bez zakupu kredytów. Jeśli brak dozwolonego API, źródło pomijamy.
- Osobno zatwierdzone zastosowanie kandydata `crm-guard.sql` i podłączenie bramki w istniejącej aplikacji. Prywatny plik z `crm-gateway.example.json`, tryb 0600/0400, rzeczywiste losowe klucze i dedykowane loginy `shadowbridge_acquisition_gateway_*` z TLS `verify-full`, członkostwem wyłącznie w istniejącym `shadowbridge_vault_ingest` i aktywnym powiązaniem źródła. Sekrety zna backend, n8n otrzymuje tylko wąski token HTTP. **Żadnego DBA ani sesji OWNER.** Bez wskazania `ACQUISITION_GATEWAY_FILE` istniejąca aplikacja pozostaje bez integracji.
- Automatyczne wpięcie `/search`, `/intake`, `/check` i checkpointów w trzy regionalne workflow po weryfikacji rzeczywistych odpowiedzi źródeł. **Obecne bazowe workflow nie zostały jeszcze przełączone na tę pamięć CRM.** Ich bramki i źródła nadal są wyłączone. Nie obiecujemy działania na podstawie nieznanego kontraktu.
- Uzupełnienie raportu 08:00 o rzeczywiste `/usage` i rozliczenia dostawców; nie sumować rezerwacji jak faktycznej faktury. Nie podłączono automatycznie nowych liczników do obecnego raportu n8n/Command Center.
- Test nieaktywnych przepływów na fikcyjnych rekordach w **istniejącym** n8n. Dopiero potem osobne zatwierdzenie produkcyjnych harmonogramów. Płatne adaptery wymagają dodatkowej zgody i zweryfikowanych kosztów.

Nie przygotowano konkurencyjnego CRM, nowych Scoutów ani drugiego n8n. Nie zmieniono czterech Scoutów Relevance ani zatrzymanego pilota NO/CZ. Nie ma mailingu lub WhatsApp. Zasada bez długiej pauzy w generowanym tekście pozostaje w podstawowym normalizerze.

## Wyniki testów

**11/11 grup rzeczywistego PostgreSQL** na nowym klonie fikcyjnej bazy: RLS, blokada surowego odczytu, aliasy Apollo/Clay, identyczne i zmienione ponowienie, konflikty nazw/domen, firmy bez fikcyjnych osób, dostępne fakty w historii CRM, wyłączone/nieznane budżety, 8 równoległych prób z jedną rezerwacją pola, brak ponownego dispatch po timeout, limity dzienne/miesięczne, ponowna kontrola przed wysłaniem, zapis uzupełnienia do historii CRM, trwała pamięć filtrów/kursorów oraz agregaty bez PII. Wynik: [integration-results.json](integration-results.json). Ostatni pełny przebieg: `acquisition_crm_test_dcad8177`. Nie resetowano źródłowej bazy.

**11/11 najnowszych testów jednostkowych/HTTP**: bramka wyłączona, token vs cookie, zakres źródła, odmowa przy DBA/BYPASSRLS/niezgodnym powiązaniu, zachowanie CSRF logowania, brak płatności przy braku CRM/duplikacie, nieponawianie niepewnego zakupu, import tylko nieaktywny, trwały checkpoint importera, brak modyfikacji aktywnych workflow i eksporty guardów. HTTP używał kontrolowanego adaptera SQL, oddzielnie od rzeczywistego testu bazy. Dodatkowo 7/7 istniejących testów walidacji OWNER VAULT i 12/12 wcześniejszych testów Nightly Global przeszło w tej sesji. Nie powtarzano całej regresji MVP.

Pierwsze próby wykryły wymagające poprawy reguły: wspólna domena błędnie wstrzymywała odrębne numery rejestrowe; dostępne dane w bieżącym zgłoszeniu trzeba zapisać przed ustaleniem brakujących pól; nowy identyfikator CRM nie może odblokować już rezerwowanego zakupu. Uzupełniono także uznawanie danych w historii za już posiadane. Poprawiono fikstury testowe z kolidującymi adresami. Powyższe wyniki dotyczą finalnego poprawionego SQL.

**NIEPRZETESTOWANE:** realny import n8n/API Apollo/Clay, rzeczywiste ceny/salda, źródła i pełny przepływ natywnego n8n. Liczba rzeczywistych płatnych wywołań: **0**. Nie gwarantujemy jeszcze nieprzerwanego pozyskiwania ani absolutnego braku duplikatów przy niepełnej tożsamości; niepewne przypadki zatrzymujemy przed zakupem.
