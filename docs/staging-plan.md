# ShadowBridge — plan internetowego stagingu

**Decyzja aktualna: publikacja i dalsze przygotowanie wdrożenia wstrzymane.**
Poniższy plan i kosztorys są zachowanym materiałem roboczym, bez zatwierdzenia
zakupów. Szkic `deploy/staging/` jest niekompletny; opis braków znajduje się w jego README.

Stan: przygotowanie do zatwierdzenia, **bez wdrożenia**, zakupów i zmian DNS. Gałąź `feature/secure-b2b-mvp`. Produkcja `shadow-bridge.eu`, `main` i GitHub Pages pozostają bez zmian. Docelowo: `https://staging.shadow-bridge.eu/`, dopiero po osobnej zgodzie na uruchomienie i rekord DNS.

## Rekomendacja i koszt

Osobny VPS w UE (Hetzner, Niemcy lub Finlandia), minimum 2 vCPU / 4 GB RAM: Node.js BFF, PostgreSQL 17, GoTrue i Caddy w izolowanym stosie Docker. Zachowuje to przetestowany lokalnie model Auth i ograniczonych ról PostgreSQL. Na stagingu początkowo wyłącznie fikcyjne dane oraz indywidualnie dopuszczeni testerzy.

| Składnik | Miesięczna rezerwa netto |
|---|---:|
| VPS i IPv4 | 6,00 EUR |
| Snapshoty dostawcy | 1,20 EUR |
| Oddzielny magazyn szyfrowanych kopii | 4,00 EUR |
| SMTP w odpowiednim bezpłatnym limicie | 0,00 EUR |
| **Razem / proponowany limit** | **11,20 EUR / 15,00 EUR** |

To **kosztorys, nie aktualna oferta dostawcy**. Próby odczytu oficjalnych cenników 19.10.2026 blokował proxy (`CONNECT 403`). Przed zakupem właściciel potwierdza cenę z koszyka, podatki i zakres usługi. Limit 15 EUR nie jest technicznym ograniczeniem naliczania opłat. Nie obejmuje domeny, administracji, pracy programistycznej, prawnej, przyszłego uploadu/OCR ani większego ruchu SMTP. Nie uruchomiono płatnego planu.

VPS wymaga wskazanej osoby odpowiedzialnej za aktualizacje systemu, obrazów, Auth, alarmy, kopie i incydenty; automatyzacja nie zastępuje tej odpowiedzialności. Jeśli właściciel nie chce takiej obsługi, wariant zarządzany Node + Supabase wymaga osobnej wyceny i próby migracji. Historyczne 7 USD za Node + 25 USD za Supabase = 32 USD/mies. **nie są potwierdzonym cennikiem na dziś**. Niestandardowa rola `NOLOGIN BYPASSRLS`, własność funkcji i trigger na `auth.users` nie zostały sprawdzone na zarządzanym Supabase. Nie wolno zastąpić ograniczonych ról połączeniem DBA, aby ominąć błąd wdrożenia.

Źródła do potwierdzenia: [Hetzner Cloud](https://www.hetzner.com/cloud/), [backupy](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/), [Storage Box](https://www.hetzner.com/storage/storage-box/), [Render](https://render.com/pricing), [Supabase](https://supabase.com/pricing), [Resend](https://resend.com/pricing).

## Warunki techniczne uruchomienia

- Osobna pusta baza i nowe losowe sekrety. Nie kopiować `.local`, lokalnych kont, haseł, kluczy ani sesji. Nie uruchamiać `npm run demo` na serwerze internetowym.
- Dodatkowa brama dostępu przed **całą aplikacją i API** z indywidualnym dopuszczeniem testerów; aplikacja nadal wymaga własnego logowania i MFA zarządu. `noindex, nofollow` oraz `robots.txt` ograniczają indeksowanie, ale nie zapewniają poufności.
- Publiczne porty 80/443; SSH ograniczony do upoważnionej administracji. PostgreSQL i Auth bez publicznie wystawionych portów. Mailpit wyłącznie prywatny, jeśli używany do przechwytywania poczty testowej.
- Ważny certyfikat HTTPS, dokładne adresy callbacków, bezpieczne ciasteczka, CSRF i brak współdzielonego cache prywatnych odpowiedzi. Połączenia do PostgreSQL z weryfikacją CA/nazwy (`sslmode=verify-full`), HTTPS do Auth; nie osłabiać walidacji do nieszyfrowanego TCP.
- Runtime wyłącznie jako ograniczone `shadowbridge_api` i `shadowbridge_sessions`; migracje jako osobny operator DBA. Sekrety poza Git, obrazami, logami i publicznym katalogiem. Aktualizacje mają przypięte wersje oraz kontrolowany rollback.
- Przed udostępnieniem: test nowej instalacji, rzeczywistej weryfikacji e-maila, zatwierdzania firm, MFA, resetu hasła, wielu kart, izolacji kont, RLS i odtworzenia kopii. Lokalny wynik nie jest testem internetowego wdrożenia.

## E-maile transakcyjne i wiadomości

Domyślnie SMTP zewnętrzny jest wyłączony: poczta trafia tylko do prywatnego przechwytywacza testowego. Nie wystawiać jego interfejsu w Internecie. Formularz kontaktowy zapisuje wiadomość do kontrolowanej kolejki; nie oznacza to automatycznego wysłania e-maila ani odpowiedzi pracownika.

Prawdziwy SMTP wymaga zatwierdzenia dostawcy, regionu, DPA, limitów i nadawcy. Po osobnej zgodzie: weryfikacja domeny/nadawcy, SPF/DKIM/DMARC, odrębne klucze stagingu, zatwierdzone linki HTTPS i brak poufnych danych ofert w treści. Zachować formalny kontakt `shadowbridge.trade@gmail.com`; nie wymyślać aliasu i nie pobierać hasła głównego Gmaila. Początkowo egzekwować po stronie serwera zamkniętą listę zatwierdzonych adresów testowych. Wysyłka do kontrahentów wymaga kolejnej zgody. Rejestrować wynik i błędy wysyłki bez tokenów oraz pełnych treści wiadomości; uwzględnić ponowienia, deduplikację i odbicia.

## Kopie, dostęp zarządu i awarie

- Codzienny szyfrowany backup danych Auth, biznesowych i kolejki oraz definicji ról; odrębny magazyn poza VPS, 7 kopii dziennych i 4 tygodniowe. Klucz odzyskiwania oraz dostęp do kopii przechowywać niezależnie od serwera. Snapshot tego samego dostawcy jest dodatkiem, nie jedyną kopią.
- Zatwierdzić cele RPO 24 h i RTO 4 h; to cele do sprawdzenia, nie SLA. Przed użytkownikami rzeczywistymi wykonać pełne odtworzenie na osobnym środowisku, sprawdzić Auth/MFA, uprawnienia, kolejkę i relacje; potem regularnie ponawiać próbę. Nie wysyłać wiadomości z odtworzonej bazy.
- Dwa indywidualne, zweryfikowane konta zarządcze z MFA, jeśli właściciel wskaże drugą upoważnioną osobę. Nie tworzyć fikcyjnego drugiego administratora ani wspólnego konta awaryjnego.
- Przy utracie jedynego MFA: udokumentowana weryfikacja właściciela, ograniczona czasowo procedura offline DBA, rejestr decyzji, cofnięcie starych sesji i ponowne zapisanie MFA. Brak publicznego bypassu, stałego uniwersalnego kodu lub automatycznego nadania administratora.
- Alerty: niedostępność, błędy Auth/SMTP, brak świeżego backupu, miejsce dysku i nietypowe decyzje administracyjne. W razie incydentu: ograniczyć dostęp, zachować dowody, unieważnić sesje/klucze według zakresu, odtworzyć lub wycofać wersję i udokumentować wynik. Ocenić obowiązki zgłoszenia naruszenia, w tym termin 72 h tam, gdzie ma zastosowanie GDPR.

## Operator i dane osobowe

SHADOWBRIDGE jest marką **THØR NORDIC COMMERCE V/ TROJANOWSKI**, organisasjonsnummer **934 957 296**, **Enkeltpersonforetak (ENK)**, Norway; nie osobną spółką. Nie dodawać VAT/MVA. Adres rejestrowy pozostaje poza publicznymi plikami do osobnego zatwierdzenia. Przed uruchomieniem dla rzeczywistych osób potwierdzić wymagany zakres informacji operatora i sposób publikacji adresu; nie deklarować kompletnej zgodności prawnej.

Zatwierdzić informację o prywatności: administrator i kontakt, cele, właściwe podstawy przetwarzania, kategorie odbiorców, okresy retencji, prawa osób, transfery i skargi do właściwego organu. Nie zastępować wszystkich podstaw ogólną „zgodą” formularza. Ustalić retencję odrzuconych aplikacji, wiadomości, logów i kopii oraz obsługę usunięcia/eksportu. Zawrzeć wymagane DPA z dostawcami; ocenić transfery poza EOG. Ocenić potrzebę DPIA zależnie od rzeczywistego zakresu i ryzyka, bez zakładania, że jest zawsze obowiązkowa. Uzgodnić warunki brokerowania, poufność, kontrolowane przedstawienia i ochronę prowizji.

## Decyzja właściciela

Najpierw jedno pytanie: **czy zatwierdzasz wariant osobnego VPS w UE z budżetem do 15 EUR netto/mies., pod warunkiem potwierdzenia aktualnej ceny przed zakupem?** Bez akceptacji nie zakładać płatnych usług. Kolejno, osobno: dostęp i odpowiedzialny administrator, adresy testerów/SMTP, a na końcu zgoda na uruchomienie i niezbędny rekord DNS stagingu. Żadna z tych decyzji nie oznacza zgody na zmianę produkcji.
