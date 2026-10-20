# ShadowBridge — specyfikacja prywatnej platformy B2B

**Dokument historyczny projektu z etapu frontendu (`2cc4de8`, 18.10.2026).**
Poniższy opis stanu bez backendu odnosi się do tamtego etapu; modele i funkcje
docelowe nie są listą obecnie zaimplementowanych modułów. Bieżąca gałąź ma
lokalny backend, uwierzytelnianie i zapis formularzy. Aktualny zakres i wykonane
testy opisuje [raport regresji z 20.10.2026](regression-2026-10-20.md),
a uruchomienie — [instrukcja operacyjna](mvp-operations.md).

Status: **projekt architektury do osobnego zatwierdzenia; backend nie jest uruchomiony**. Data: 18 października 2026. Punktem wyjścia tej gałęzi jest produkcyjny commit `d0512dd`. Poniższe tabele, API i polityki są dokumentacją przyszłego wdrożenia, a nie działającą konfiguracją.

## 1. Zakres obecnego etapu

Witryna pozostaje stroną selektywnego pośrednika handlowego. Publiczne wejścia Buyer, Supplier i B2B Partner wyjaśniają proces aplikacji; wspólne Member Sign In przedstawia przyszły punkt logowania. Prototypy paneli używają wyłącznie jawnie oznaczonych fikcyjnych danych. Nie ma rejestracji, logowania, przesyłania dokumentów ani zapisu formularzy na serwerze. Formularze demonstracyjne nie wysyłają danych, nie zapisują ich w localStorage, ciasteczkach ani analityce i nie ogłaszają sukcesu rejestracji. Nie należy wpisywać rzeczywistych danych biznesowych do prototypów.

Przed uruchomieniem backendu nie wolno przyjmować rzeczywistych zgłoszeń kont ani poufnych ofert przez nowe interfejsy. Obecny publiczny kontakt ShadowBridge pozostaje dostępny, ale nie zastępuje przyszłego bezpiecznego kanału ofert i dokumentów. Nie powstaje katalog kontrahentów, otwarta giełda ani automatyczne kojarzenie kupujących i dostawców.

## 2. Reguła poufności obowiązująca wszystkie role

- Kupujący nie otrzymuje nazwy dostawcy, bezpośrednich danych kontaktowych, domeny, dokumentu identyfikującego dostawcę ani identyfikatora CRM. Dostawca nie otrzymuje tożsamości kupującego ani zapytań innych firm.
- Każda okazja widoczna w przyszłym portalu ma losowy identyfikator ShadowBridge, zatwierdzony opis oraz jawnie przydzielonych odbiorców. Weryfikacja firmy sama nie nadaje dostępu do ofert. Brak przydziału oznacza odmowę.
- Wszystkie początkowe zapytania, negocjacje i przedstawienia stron przechodzą przez ShadowBridge. Wiadomości partnerów nie trafiają bezpośrednio do kontrahenta ani do wspólnego, niekontrolowanego wątku e-mail.
- Pełne dane i powiązania istnieją wyłącznie w chronionym backendzie Command Center. Serwer tworzy osobne, ograniczone DTO dla portali. Ukrycie kolumny w HTML, CSS lub JavaScript nie jest kontrolą dostępu.
- Weryfikacja członkostwa, statusu konta, roli i konkretnego przydziału następuje przy każdym żądaniu, eksporcie, odczycie pliku oraz otwarciu WebSocket. Interfejs może poprawiać ergonomię, lecz nie podejmuje decyzji bezpieczeństwa.
- Dopuszczalne późniejsze ujawnienie tożsamości jest osobnym, udokumentowanym procesem zarządu, opisanym w punkcie 8. Zwykła oferta, jej akceptacja ani status „verified” nigdy go nie uruchamiają.

Identyfikatory publikowane nie mogą zawierać identyfikatora firmy, numeru CRM, NIP, e-maila, numeru wewnętrznej oferty ani przewidywalnego licznika. Generować co najmniej 128 bitów losowości; prefiks typu `SB-O-` służy tylko prezentacji. Rozważyć odrębny identyfikator dla każdego zatwierdzonego odbiorcy, aby ograniczyć korelację i enumerację. Identyfikator nie zastępuje autoryzacji. Czytelne oznaczenia `DEMO` w obecnych makietach są wyłącznie fikcyjnymi przykładami.

## 3. Proponowany stos i granice systemów

1. **Publiczny frontend i osobny frontend portalu:** statyczne zasoby, docelowo Cloudflare Pages lub porównywalny hosting komercyjny. Bieżąca produkcja GitHub Pages pozostaje bez zmian. Repozytoryjny podgląd nie może automatycznie publikować dokumentacji ani prototypów na produkcji. Prywatne dane nie są częścią kompilacji statycznej, plików JSON, source map ani parametrów adresów.
2. **Backend-for-frontend/API:** Supabase Edge Functions albo niewielka aplikacja serwerowa. Waliduje sesję, bieżący status i uprawnienia, wykonuje ścisłe zapytania oraz mapuje DTO. Dla aplikacji przeglądarkowej preferowana sesja w `Secure; HttpOnly; SameSite` cookie na wspólnej domenie aplikacji/API, ochrona CSRF i ścisły CORS. Nie przechowywać tokenów sesji w localStorage. Implementację odświeżania i wylogowania należy oprzeć na oficjalnym SDK i przetestować.
3. **Supabase Auth + PostgreSQL:** weryfikacja adresu e-mail, odzyskiwanie konta, sesje; relacyjna baza, RLS i transakcje. Nie wykorzystywać JWT z rolą jako jedynego źródła aktualnych uprawnień. Odebranie dostępu ma działać również przed wygaśnięciem starego JWT.
4. **Prywatny magazyn obiektowy:** osobne strefy kwarantanny, oryginałów i zatwierdzonych kopii. Brak publicznych bucketów dla zgłoszeń i dokumentów. Pliki wydaje autoryzowany endpoint lub bardzo krótko ważny, ograniczony URL po każdorazowej kontroli; dla szczególnie wrażliwych dokumentów preferowany strumień przez backend. Sam podpisany URL jest uprawnieniem i może być przekazany dalej.
5. **E-mail transakcyjny:** Resend lub porównywalny dostawca z własnym zweryfikowanym nadawcą, SPF/DKIM/DMARC i oddzieleniem powiadomień od korespondencji handlowej. Gmail kontaktowy strony zachowuje obecną funkcję. Nie dołączać treści poufnych ofert do powiadomień — tylko informację o wiadomości i link do portalu.
6. **Przetwarzanie dokumentów:** izolowany worker z kolejką, skanowaniem antymalware, OCR i ręczną akceptacją. Ciężkiego OCR nie wykonywać w żądaniu użytkownika ani zakładać, że mieści się w bezpłatnych limitach edge. Bez zatwierdzonego procesu dokumentów upload pozostaje wyłączony.

Command Center ma osobny interfejs, serwerowe uprawnienia pracownicze i MFA; zalecana jest odrębna aplikacja/konfiguracja sesji. C.A.R.T.E.L. Private Division ma odrębne członkostwo, zasoby i przydziały. Członkostwo C.A.R.T.E.L., rola partnera ani posiadanie konta klienta **nie przyznają** uprawnień administracyjnych. Kontrola dostępu po stronie serwera pozostaje obowiązkowa także przy oddzielnych domenach.

## 4. Role, operacje i stany

| Odbiorca | Dostęp do własnych danych | Dane innych firm | Anonimowe okazje | Uprawnienia administracyjne |
|---|---|---|---|---|
| Gość | Publiczna informacja i opis aplikacji | Brak | Brak otwartego katalogu | Brak |
| Zgłaszający, e-mail niepotwierdzony | Potwierdzenie własnego e-maila | Brak | Brak | Brak |
| Konto oczekujące/odrzucone | Własny status i dozwolone uzupełnienia aplikacji | Brak | Brak | Brak |
| Buyer: firma i konto zatwierdzone | Własne RFQ i wiadomości z ShadowBridge | Brak tożsamości dostawcy | Wyłącznie osobno przydzielone, zatwierdzone karty | Brak |
| Supplier: firma i konto zatwierdzone | Własne szkice ofert, dokumenty i statusy | Brak kupujących i cudzych RFQ | Tylko oddzielnie zatwierdzona, zanonimizowana informacja potrzebna do współpracy | Brak |
| B2B Partner: zatwierdzony | Własne zgłoszenia, przydzielone zadania i indywidualne prowizje | Brak pełnej bazy kontrahentów | Tylko zatwierdzony zakres przydzielonego projektu | Brak |
| C.A.R.T.E.L. Member | Zasoby tej dywizji zgodnie z zaproszeniem | Wyłącznie jej indywidualne przydziały | Brak automatycznego dostępu do B2B | Brak |
| Upoważniony pracownik | Zakres nadany przez zarząd | Zgodnie z osobnymi uprawnieniami i celem | Tworzenie/akceptacja według zakresu | Tylko jawnie nadane kompetencje |
| Konto zawieszone | Wylogowanie i informacja o ograniczeniu; obsługa sprawy przez ShadowBridge | Brak | Brak, także wcześniej przydzielonych | Brak |

Firma może ubiegać się o więcej niż jedną rolę, ale każda wymaga osobnego zatwierdzenia; role nie sumują automatycznie dostępu do obcych danych. Nowy pracownik zatwierdzonej firmy wymaga osobnego członkostwa. Użytkownik nie wybiera samodzielnie firmy przez znajomość jej nazwy lub domeny.

**Aplikacja:** `draft → email_pending → submitted → under_review → needs_information / approved / rejected / withdrawn`. Weryfikacja e-maila nie oznacza zatwierdzenia firmy. Backend ogranicza duplikaty, nadużycia i enumerację adresów; odpowiedzi odzyskiwania hasła są neutralne. Pracownik ocenia realność firmy i reprezentację, zapisuje decyzję i jej uzasadnienie. Zmiana tożsamości/reprezentacji wymaga ponownej oceny. Minimalizować zbierane dane; dokumenty identyfikacyjne osób tylko przy rzeczywistej konieczności i ustalonej podstawie prawnej.

**Konto i członkostwo:** konto `active / suspended / closed`, firma `unverified / in_review / verified / suspended`, członkostwo `pending / approved / suspended / revoked`. Dostęp wymaga zgodności wszystkich trzech statusów, zweryfikowanego e-maila, właściwej roli oraz przydziału konkretnego zasobu. Zawieszenie unieważnia sesje i przydziały; nowe pobrania są blokowane natychmiast.

**RFQ kupującego:** własny `draft → submitted → in_review → clarification_required → accepted / declined → in_progress → closed`. Pola: produkt, specyfikacja, ilość i jednostka, budżet i waluta, państwo dostawy, termin, preferowane warunki, poufne załączniki. Dostawcy nigdy nie przeglądają tabeli RFQ. ShadowBridge tworzy osobną, zatwierdzoną projekcję potrzebną do wybranej rozmowy.

**Oferta dostawcy:** własny `draft → submitted → internal_review → changes_requested / rejected / approved → expired / withdrawn`. Pola: produkt, specyfikacja, ilość, cena i waluta, MOQ, Incoterms wraz z wersją/miejscem, dostępność, kraj i warunki dostawy, dokumenty. Stan `approved` nie jest publikacją. Dopiero zatwierdzona, odrębna wersja anonimowej karty + konkretny przydział umożliwiają odczyt przez odbiorcę. Zmiana warunków lub dokumentu tworzy nową wersję i wymaga ponownej oceny; użytkownik edytuje wyłącznie własne szkice lub wersje odesłane do poprawy. Cofnięcie zgody wygasza przydziały.

**B2B Partner:** zgłoszenie `draft → submitted → screening → accepted / declined`; przydzielony projekt `proposed → agreed → in_progress → on_hold / completed / cancelled`. Prowizja ma osobną umowę, podstawę naliczenia, walutę, moment wymagalności i status; makieta nigdy nie potwierdza rzeczywistej należności. Partner widzi tylko swoje uzgodnione warunki.

## 5. Minimalny model relacyjny

Wszystkie identyfikatory wewnętrzne: UUID, znaczniki czasu UTC, kwoty `numeric` z walutą ISO 4217, ilości z jednostką i walidacją. Hasła pozostają wyłącznie w dostawcy Auth. Klucze obce i ograniczenia muszą zapobiegać podpięciu rekordu do innej firmy; operacje wielotabelowe są transakcyjne.

| Tabela / strefa | Główne pola i relacje | Zasada dostępu |
|---|---|---|
| `auth.users` | Identyfikator konta, stan weryfikacji, sesje | Zarządzane przez Auth; bez publicznego odczytu użytkowników |
| `internal.companies` | `id`, nazwa prawna, dane rejestrowe, domeny, status weryfikacji | Pełna tożsamość tylko Command Center; własny ograniczony profil przez API |
| `internal.company_contacts` | `id`, `company_id`, imię, e-mail, telefon, funkcja | Dane poufne, osobne uprawnienie pracownicze |
| `internal.applications` | `id`, `applicant_user_id`, `company_id`, żądana rola, status, decyzja, reviewer | Własny status przez DTO; decyzje wyłącznie pracownik |
| `internal.memberships` | `id`, `user_id`, `company_id`, rola, status, `approved_by` | Unikalność aktywnego członkostwa dla użytkownika/firmy/roli |
| `internal.staff_grants` | `user_id`, konkretna kompetencja, zakres, termin, nadawca | Wyłącznie właściciel/uprawniony zarząd; bez samonadawania |
| `internal.purchase_requests` | `id`, `buyer_company_id`, `created_by`, wersja, pola RFQ, status | Własna firma w dozwolonym zakresie + uprawnieni pracownicy |
| `internal.supplier_offers` | `id`, `supplier_company_id`, autor, wersja, warunki, status | Własny dostawca + uprawnieni pracownicy |
| `internal.opportunity_versions` | `id`, źródłowa oferta/RFQ, wersja, wewnętrzne powiązania, review status | Pełne mapowanie wyłącznie Command Center |
| `portal.opportunity_cards` | Losowy `public_id`, zatwierdzony tytuł/specyfikacja, ilość, warunki, wersja, status | **Wyłącznie dozwolone anonimowe pola**, bez FK do CRM/firmy/oferty źródłowej |
| `internal.opportunity_card_mappings` | `public_id`, `opportunity_version_id`, wewnętrzne źródła | Mapowanie niedostępne portalom, także w API |
| `internal.opportunity_grants` | `public_id`, `recipient_membership_id`, akceptujący, okres, cofnięcie | Konkretny zatwierdzony odbiorca; kontrola przy każdym żądaniu |
| `internal.enquiries` | `id`, publiczna karta, autor/członkostwo, status, koordynator | Własny autor + ShadowBridge; brak bezpośredniego adresata-kontrahenta |
| `internal.message_threads`, `messages`, `thread_participants` | Wątki użytkownik–ShadowBridge, treść, dozwoleni uczestnicy, moderacja | Odrębne wątki obu stron; przekazanie treści wymaga oceny |
| `internal.partner_opportunities`, `project_assignments` | Autor, opis wewnętrzny, projekt, indywidualny zakres zadania | Własny autor/przydzielony partner; bez pełnego rekordu transakcji |
| `internal.transactions`, `transaction_parties` | Wewnętrzne strony, oferty, RFQ, etapy, kwoty | Command Center; portal dostaje oddzielny, zatwierdzony status |
| `internal.commission_agreements`, `commission_events` | Partner, transakcja, zasady, waluta, wersja umowy, wymagalność | Upoważniony zarząd + własny ograniczony widok partnera |
| `internal.introductions`, `disclosure_approvals` | Strony, odbiorca, cel, zakres pól, zgody, approver, okres | Wyłącznie proces kontrolowanego ujawnienia |
| `internal.agreements`, `agreement_acceptances` | Typ NDA/non-circumvention/prowizja, wersja, podpisujący, dowód | Uprawnieni pracownicy i właściwa strona; bez obcych warunków |
| `internal.uploads`, `document_reviews` | Właściciel, losowy klucz obiektu, hash, typ, stan skanowania, reviewer | Oryginał nigdy nie trafia do karty publicznej |
| `portal.document_derivatives` | Nowy identyfikator bezpiecznej kopii, karta, wersja, zatwierdzenie | Wyłącznie kopia po osobnej kontroli; odziedziczony przydział karty |
| `internal.audit_events`, `outbox_events` | Kto, co, kiedy, cel, wynik, idempotencja wysyłek | Log dopisywany przez zaufany backend; brak edycji przez portale |
| `internal.cartel_memberships`, `cartel_grants` | Zaproszenie, członkostwo, zasób i zakres | Niezależne od B2B i `staff_grants` |

Nie łączyć wszystkich uprawnień w jeden modyfikowalny przez klienta `role`. Duże oferty/plikowe wersje i załączniki mają własne identyfikatory i historię; usunięcie członkostwa nie może usuwać historii umów/transakcji. Okresy retencji, podstawy prawne RODO, umowy powierzenia i obsługę żądań osób ustalić przed zbieraniem danych. Logi przechowują metadane zdarzeń i odniesienia; nie kopiują automatycznie całych poufnych treści, tokenów i dokumentów.

### Przykład RLS — wyłącznie dokumentacja

Poniższy fragment pokazuje kierunek polityki. Nie jest kompletną migracją ani kodem do uruchomienia bez przeglądu. Schemat `internal` nie jest wystawiany przez Data API. Połączenia portalowe używają ograniczonej roli i tożsamości użytkownika, nie klucza `service_role` omijającego RLS.

```sql
-- DOCUMENT ONLY. auth.uid() pochodzi ze zweryfikowanego JWT,
-- nigdy z body / nagłówka wskazanego przez przeglądarkę.
alter table portal.opportunity_cards enable row level security;
alter table portal.opportunity_cards force row level security;
revoke all on portal.opportunity_cards from anon, authenticated;
grant select on portal.opportunity_cards to authenticated;

create policy approved_recipient_can_read
on portal.opportunity_cards for select to authenticated
using (
  publication_status = 'approved'
  and exists (
    select 1
    from internal.opportunity_grants g
    join internal.memberships m on m.id = g.recipient_membership_id
    join internal.companies c on c.id = m.company_id
    join internal.account_status s on s.user_id = m.user_id
    where g.public_id = opportunity_cards.public_id
      and m.user_id = auth.uid()
      and m.status = 'approved'
      and c.verification_status = 'verified'
      and s.status = 'active'
      and s.email_verified_at is not null
      and g.revoked_at is null
      and g.valid_from <= now()
      and (g.valid_until is null or g.valid_until > now())
  )
);
```

`internal.account_status` jest serwerową projekcją Auth/statusu konta, aktualizowaną przez zaufany proces, nie przez klienta. W implementacji należy rozstrzygnąć dostęp polityki do tabel `internal`: minimalny, starannie sprawdzony helper `SECURITY DEFINER` zwracający wyłącznie boolean albo wąska rola wykonująca. Helper ma stały pusty `search_path`, pełne nazwy schematów, jawne `GRANT EXECUTE`, brak dostępu `PUBLIC`, brak dynamicznego SQL oraz obowiązkowy warunek `auth.uid()` i testy enumeracji. Samo wklejenie powyższej polityki bez tych praw nie zadziała i nie stanowi gotowego zabezpieczenia.

Uprawnienia zapisu do kart, przydziałów i decyzji pozostają odebrane użytkownikom portalu. Osobne polityki własnych RFQ/ofert wymagają połączenia `created_by`, aktywnego członkostwa i zgodnego `company_id` zarówno w `USING`, jak i `WITH CHECK`; klient nie może zmieniać właściciela, zatwierdzenia ani numeru źródła. Funkcja zgłoszenia sprawdza dozwolone przejście stanu w transakcji. RLS nie zastępuje walidacji pól i logiki API. Właściciel bazy oraz role `BYPASSRLS` wymagają szczególnej ochrony; `FORCE RLS` nie unieszkodliwia klucza administracyjnego.

## 6. API i dane wysyłane do przeglądarki

| Przyszły endpoint | Działanie | Obowiązkowy filtr |
|---|---|---|
| `POST /api/applications` | Przyjęcie minimalnej aplikacji po uruchomieniu bezpiecznego backendu | Weryfikacja sesji/e-maila, walidacja, rate limit, zgody i ochrona przed duplikatami |
| `GET /api/me/application` | Własny etap i dozwolone uzupełnienia | Bieżący użytkownik; bez notatek pracownika |
| `POST /api/buyer/requests` | Własny szkic RFQ | Zatwierdzona rola Buyer i firma; tożsamość właściciela ustala serwer |
| `POST /api/supplier/offers` | Własny szkic oferty | Zatwierdzona rola Supplier i firma; bez klientowskiego statusu approved |
| `POST /api/.../:id/submit` | Zgłoszenie wersji do oceny | Własność, prawidłowy stan, wersja, kompletność; brak automatycznej publikacji |
| `GET /api/opportunities` | Ograniczone karty bez katalogu wszystkich ofert | Aktualne indywidualne przydziały i zatwierdzona wersja |
| `POST /api/opportunities/:publicId/enquiries` | Zapytanie do ShadowBridge | Odczyt tej karty dozwolony; adresata i routing ustala serwer |
| `GET /api/partner/projects`, `/commissions` | Własne zadania i uzgodnione warunki | Konkretny aktywny przydział/umowa, bez danych innych partnerów |
| `POST /api/uploads/intents` | Ograniczony upload do kwarantanny | Własność, cel, limit rozmiaru/typu, quota, krótki termin |
| `GET /api/documents/:id` | Odczyt dozwolonej kopii | Aktualna sesja, przydział, wersja, status przeglądu; bez publicznego bucketu |

Dozwolony przykładowy `OpportunityCardDTO`:

```json
{
  "offerId": "SB-O-<losowy-identyfikator>",
  "title": "Approved non-identifying product description",
  "specification": "Manually reviewed specification",
  "quantity": { "value": 20, "unit": "tonne" },
  "commercialTerms": { "currency": "EUR", "incoterm": "FCA" },
  "availabilityWindow": "Approved date range",
  "enquiryChannel": "ShadowBridge",
  "approvedDocuments": []
}
```

Pole kraju, portu, fabryki, wyjątkowej specyfikacji, ceny lub certyfikatu bywa identyfikatorem pośrednim. Pracownik może je uogólnić lub pominąć. Nie należy bezwarunkowo publikować wszystkich pól tylko dlatego, że są „handlowe”. DTO nie zawiera `supplier`, `buyer`, `companyId`, `supplierId`, `crmId`, domeny, e-maila, telefonu, pierwotnej nazwy pliku, oryginalnego URL, notatek wewnętrznych, powiązań transakcyjnych ani pełnych obiektów ORM. API używa listy dozwolonych pól, nie listy pól do usunięcia. Osobne DTO własnego RFQ/oferty może zawierać dane własnego zgłoszenia, ale nigdy rekord przeciwnej strony.

Autoryzacja obejmuje filtrowanie, wyszukiwanie, sortowanie, liczniki, eksporty i błędy — nie wolno ujawnić istnienia lub liczby cudzych rekordów przez agregaty. Zasoby niedostępne zwracają spójną odpowiedź bez potwierdzania ich istnienia. Wrażliwe odpowiedzi: `Cache-Control: private, no-store`, wyłączenie współdzielonego cache/CDN/service workera, brak treści w telemetrii. CSP, ograniczony CORS, CSRF, walidacja wejścia, bezpieczne renderowanie tekstu i limity żądań stanowią część wdrożenia.

## 7. Dokumenty i opisy przed udostępnieniem

1. Użytkownik uzyskuje ograniczone uprawnienie zapisu do **kwarantanny**, pod losowym kluczem niezawierającym nazwy firmy. Sprawdzić rozszerzenie i realny typ, rozmiar, liczbę stron, archiwa i limity rozpakowania; odrzucić nieobsługiwane/zaszyfrowane pliki oraz aktywną zawartość zgodnie z polityką.
2. Worker skanuje plik i wydobywa tekst, OCR obrazów, metadane PDF/Office, EXIF, nazwy autorów, komentarze, śledzenie zmian, ukryte arkusze, nazwy plików, łącza, załączniki osadzone, logotypy, podpisy, QR/kody kreskowe, numery certyfikatów i identyfikatory partii. Opisy produktów oraz wiadomości zgłaszane do przekazania przechodzą analogiczną kontrolę identyfikatorów.
3. Wykryte sygnały trafiają do uprawnionego pracownika. Automatyczne wykrycie jest pomocą, **nie gwarantuje anonimizacji**. Niewykryta wskazówka, grafika, branżowy certyfikat lub unikalna kombinacja danych może identyfikować podmiot.
4. Powstaje nowa kopia z trwałą redakcją treści i oczyszczonymi metadanymi. Czarna nakładka na tekst nie wystarcza. Ponownie sprawdzić wyszukiwanie, kopiowanie tekstu, OCR, warstwy i osadzone obiekty. Nie udostępniać źródłowego pliku ani ścieżki do niego.
5. Pracownik zatwierdza konkretny hash/wersję kopii oraz jej odbiorców. Przy ryzyku identyfikacji przygotować nowy neutralny dokument ShadowBridge zamiast przerabiać oryginał; gdy ryzyka nie można usunąć, nie publikować. Nowy plik lub opis cofa wcześniejszą ocenę do ponownej weryfikacji.
6. Udostępnienie, pobranie i cofnięcie zgody są logowane. Wycofanie dostępu blokuje przyszłe odczyty, ale nie usuwa kopii wcześniej pobranej przez odbiorcę; warunki handlowe, ograniczenie ujawnień i oznaczenia kopii są zatem istotne.

Stany: `quarantined → scanning → review_required → redaction_required → approved_derivative / rejected`; awaria skanera/OCR oznacza blokadę publikacji, a nie akceptację. Storage oryginałów ma odrębne reguły dostępu i retencji. Nie wysyłać dokumentów do zewnętrznego AI bez osobno zatwierdzonej usługi, warunków przetwarzania i uprawnień; agent AI nie ma domyślnego dostępu do całego CRM.

## 8. Kontrolowane przedstawienie kontrahentów

Pracownik inicjuje propozycję przedstawienia z celem, stronami, dokładnym zakresem pól i wskazaniem odbiorców. Upoważniony zarząd weryfikuje umocowanie stron, wymagane NDA, warunki prowizji i ochronę przed obchodzeniem pośrednika; umowy oraz ich skuteczność należy uzgodnić z prawnikiem. Podpisane/zaakceptowane wersje i dowody utrwala się przed ujawnieniem. Dla wrażliwych ujawnień rekomendowana jest akceptacja drugiej uprawnionej osoby; przy jednoosobowej działalności co najmniej dodatkowe uwierzytelnienie i jawna czynność zatwierdzenia właściciela.

Backend dopuszcza wyłącznie wskazane pola, odbiorców, cel i okres. Zapisuje nieedytowalne zdarzenie: inicjator, zatwierdzający, podstawy umowne, odbiorca, zakres, czas i rezultat. Dane przekazuje oddzielny kanał kontrolowanego przedstawienia, bez trwałego odblokowania pełnej bazy firm lub całej oferty źródłowej. Cofnięcie dostępu jest odnotowane. Każdy etap negocjacji, przedstawienia, uzgodnienia prowizji i transakcji pozostaje powiązany wewnętrznie w Command Center.

## 9. Testy wymagane przed rzeczywistymi danymi

Testy muszą działać na API i bazie z różnymi użytkownikami, a nie tylko na widoczności przycisków:

- Buyer A próbuje odczytać/zmienić RFQ Buyer B przez UUID, filtr, eksport, licznik i bezpośrednie Data API; odmowa. Supplier A nie odczytuje ofert Supplier B ani RFQ kupującego.
- Użytkownik verified bez konkretnego przydziału nie czyta karty ani dokumentu. Odbiorca jednej wersji nie dostaje kolejnej bez zatwierdzenia. Wygaśnięcie/cofnięcie, zawieszenie użytkownika lub firmy oraz stare JWT natychmiast blokują kolejne odczyty.
- Zmiana `company_id`, `created_by`, roli, ceny zatwierdzonej wersji, pola `approved`, przydziału lub własnej prowizji w request body nie podnosi uprawnień. Warunki `WITH CHECK` i przejścia stanów są testowane bez UI.
- Karty, błędy, HTML, JSON, source mapy, nagłówki, logi klienta, wyszukiwarka, pliki i powiadomienia nie zawierają pól identyfikujących kontrahenta. Test kontraktu DTO ma zamknięty zbiór kluczy i kontrolę przykładowych znaczników PII z danych testowych.
- Członkostwo C.A.R.T.E.L., role Buyer/Supplier/Partner oraz konto serwisowe od dokumentów nie nadają uprawnień Command Center. Pracownik bez `identity_disclosure` nie ujawnia tożsamości; nie może też sam sobie nadać tego uprawnienia.
- Link do pliku bez sesji, po wygaśnięciu lub dla innego odbiorcy nie daje dostępu. Oryginał, miniatura, OCR i archiwum nie omijają reguł. Podmiana obiektu po ocenie zmienia hash i blokuje publikację.
- Dokument testowy z PII w metadanych, warstwie OCR, QR, stopce, komentarzu, nazwie pliku i obrazie jest zatrzymany; czarna nakładka nie przechodzi jako redakcja. Awaria workera nie dopuszcza dokumentu do publikacji.
- Przejęcie sesji/CSRF/XSS, rate limiting, enumeracja e-maila, odzyskiwanie konta, MFA pracowników, usuwanie sesji, brak sekretów w frontendzie oraz błędna konfiguracja RLS mają osobne testy integracyjne.
- Odtworzenie backupu, odtworzenie relacji i audytu, idempotentne wiadomości, awarie kolejki oraz wycofanie wdrożenia są sprawdzane przed dopuszczeniem rzeczywistych danych.

## 10. Koszty i kolejny etap do zatwierdzenia

W tym etapie nie założono kont usługowych, nie uruchomiono usług i nie poniesiono kosztów. Poniższe kwoty są **orientacyjnym budżetem w USD/miesiąc, bez podatków**, opartym na znanych wcześniejszych stawkach, a nie potwierdzoną ofertą na 18.10.2026. Próby odczytu oficjalnych cenników tego dnia były blokowane przez proxy środowiska (`CONNECT 403`). Przed akceptacją backendu trzeba sprawdzić aktualne plany, region UE, limity, podatki, DPA i limity wydatków w panelu dostawcy.

| Składnik | Mały pilotaż bez danych poufnych | Orientacyjny wariant z rzeczywistymi danymi |
|---|---|---|
| Statyczny frontend | Cloudflare Pages Free, jeśli aktualny plan odpowiada wymaganiom | Zwykle 0 USD przy małym ruchu statycznym |
| Auth + PostgreSQL + prywatny storage + API | Supabase Free tylko do nieprodukcyjnych prób | Supabase Pro: wcześniejsza stawka bazowa ok. 25 USD/projekt; potwierdzić compute, backupy i dopłaty |
| E-mail transakcyjny | Resend Free przy małym ruchu; wcześniej 3 000/mies. i 100/dzień | Wcześniejszy płatny próg ok. 20 USD/mies.; alternatywa według wolumenu |
| Kolejka/skanowanie/OCR | Wyłącznie fikcyjne pliki testowe | Orientacyjnie 5–20 USD za małego workera; koszt zależy od liczby stron i rozwiązania OCR, może być wyższy |
| Dodatkowy edge/backend | Nie jest potrzebny, jeśli wystarczą zatwierdzone Edge Functions | Cloudflare Workers Paid miał próg ok. 5 USD/mies.; nie kupować dodatkowej warstwy bez potrzeby |
| Kopie zapasowe i monitoring | Testowy budżet 0 USD | Rezerwa 5–15 USD i ewentualne dopłaty; uzgodnić RPO/RTO, weryfikować realne odtwarzanie |

Praktyczny budżet małego, płatnego wdrożenia to orientacyjnie **35–85 USD/mies.** przy niskim ruchu, bez pracy programistycznej, domeny, obsługi prawnej, płatnych agentów AI i drogich usług OCR. Jeżeli limity e-maila nie wystarczą albo potrzebny będzie odrębny staging/większy compute, koszt wzrośnie. Nie należy przedstawiać bezpłatnej bazy jako gwarancji niezawodności: plany testowe mogą ograniczać backupy, zasoby, dostarczanie e-maili, okresy bezczynności i wsparcie, bez wymaganej dla firmy gwarancji SLA. Powiadomienia o budżecie nie zawsze stanowią twardy limit kosztów.

Oficjalne źródła do ponownego sprawdzenia przed zakupem (próba dostępu: 18.10.2026, treść niedostępna z tego środowiska):

- [Supabase Pricing](https://supabase.com/pricing) i [Going into production](https://supabase.com/docs/guides/platform/going-into-prod).
- [Cloudflare Developer Platform](https://www.cloudflare.com/plans/developer-platform/) oraz [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/).
- [Resend Pricing](https://resend.com/pricing).
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), jeśli osobny storage okaże się potrzebny; na początku preferowany jest jeden zatwierdzony magazyn prywatny.

Kolejny etap wymaga osobnego zatwierdzenia dostawców i budżetu, modelu danych oraz polityk dostępu. Kolejność: threat model i retencja → osobne środowisko testowe i migracje → Auth i ręczna ocena aplikacji → testy izolacji RLS/API → własne RFQ/oferty → kwarantanna i ręczna anonimizacja → indywidualne przydziały i zapytania do ShadowBridge → audyt i odtwarzanie → dopuszczenie rzeczywistych danych. Wdrożenie Command Center oraz C.A.R.T.E.L. jest odrębnym zakresem, nie częścią obecnych makiet.
