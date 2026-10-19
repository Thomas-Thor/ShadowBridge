# ShadowBridge — przyszłe zdjęcia i dokumenty ofert

Status: **specyfikacja przyszłej funkcji**. Upload, worker skanujący, storage i zatwierdzanie plików nie są zaimplementowane ani wdrożone. Nie przyjmować rzeczywistych materiałów, dopóki cały proces nie przejdzie testów i osobnego zatwierdzenia. Koszty magazynu/skanowania wymagają osobnej decyzji.

## Cel i dozwolone materiały

Zdjęcia produktu, palet, opakowań, magazynu, kontenerów i transportu; dokumenty ze specyfikacją, certyfikatami, wymiarami, wagą i opakowaniem. Oryginały służą kontroli ShadowBridge, a kupujący może otrzymać wyłącznie zatwierdzoną, nieidentyfikującą wersję dla konkretnej okazji.

Proponowane limity pierwszego etapu: maksymalnie 10 zdjęć po 10 MB i 5 dokumentów PDF po 20 MB na ofertę, łącznie 200 MB. Zdjęcia: JPEG, PNG i WebP; dokumenty: PDF bez szyfrowania. Limity są wymaganiem projektowym, nie obecnie działającą funkcją. Kontrolować także piksele, strony, czas przetwarzania i limit firmy. Odrzucać SVG/HTML, pliki wykonywalne, Office z makrami, archiwa, zdalne URL oraz typy spoza listy; sam MIME lub rozszerzenie nie wystarcza.

## Prywatny przepływ

1. API sprawdza aktywną firmę, rolę Supplier, własność szkicu i limity. Serwer wystawia krótki, jednorazowy intent wyłącznie do zapisu w kwarantannie, pod losowym kluczem bez nazwy kontrahenta. Dostęp nie może wskazywać dowolnego bucketu ani ścieżki.
2. Ograniczony worker w izolacji sprawdza rzeczywisty typ/magic bytes, rozmiar, limity dekodowania i hash; uruchamia aktualny ClamAV lub zatwierdzony skaner. Awaria, nieaktualne sygnatury, timeout i niejednoznaczny wynik blokują dalsze udostępnianie. Antywirus nie oznacza anonimizacji.
3. Worker analizuje EXIF/GPS, autora, program, nazwy plików, warstwy OCR, komentarze, załączniki, aktywną zawartość, linki i ukryty tekst PDF. OCR i ręczny przegląd szukają logo, danych kontaktowych, podpisów, tablic rejestracyjnych, etykiet, numerów certyfikatów/partii, QR, kodów kreskowych i identyfikatorów firm.
4. Tworzy oddzielny oczyszczony plik: ponownie kodowane zdjęcie lub dokument po trwałej redakcji, z usuniętymi metadanymi. Czarny prostokąt przykrywający tekst w PDF nie wystarcza. Sprawdzić kopiowanie, wyszukiwanie, OCR, warstwy i miniatury. Nie stosować zewnętrznego AI/OCR bez zatwierdzenia przetwarzania danych.
5. Pracownik ocenia ryzyko identyfikacji i prawdziwość opisu. Unikalny produkt, certyfikat lub lokalizacja mogą wskazać kontrahenta mimo usunięcia e-maila. Jeśli ryzyka nie można usunąć, przygotować neutralny materiał ShadowBridge albo odmówić publikacji.
6. Uprawniony pracownik zatwierdza konkretny hash/wersję kopii, powiązaną okazję i wskazanych odbiorców. Samo zatwierdzenie oferty nie zatwierdza wszystkich plików. Zmiana źródła lub kopii wymaga ponownego przeglądu.
7. API autoryzuje każde wyświetlenie/pobranie. Cofnięcie przydziału, zawieszenie konta lub wycofanie wersji blokuje następne odczyty; nie odbiera pliku wcześniej pobranego przez odbiorcę.

Stany: `quarantined → scanning → review_required → redaction_required → approved_derivative / rejected`; błędy pozostają zablokowane. Oryginał nigdy nie trafia do Buyer. Supplier widzi wyłącznie własne materiały, a zarząd dostęp zgodny z indywidualnym zakresem obowiązków.

## Pochodzenie i inspekcja

- `supplier_claimed`: materiał dostawcy; prezentować „Submitted by supplier”, bez domyślnego zapewnienia niezależnej weryfikacji.
- `independent_inspection`: status nadawany przez uprawnionego pracownika dopiero po sprawdzeniu dowodu inspekcji, daty, zakresu, powiązania z towarem/partią i autentyczności dokumentu. Przesłanie certyfikatu samo nie nadaje odznaki.
- Tożsamość inspektora i źródłowy raport pozostają wewnętrzne, jeśli mogłyby ujawnić kontrahenta. Kupujący otrzymuje zatwierdzony zakres i datę kontroli, bez danych identyfikujących. Kontrola jednego zdjęcia lub partii nie oznacza kontroli całej oferty.
- Korekta lub redakcja zdjęcia jest odnotowana; nie tworzyć obrazu sugerującego inspekcję, której nie było. Wycofanie dowodu cofa właściwy status i przydziały.

## Dane i uprawnienia po stronie serwera

| Przyszła tabela | Zakres |
|---|---|
| `offer_assets` | Firma właściciela, oferta, rodzaj, prywatny klucz oryginału, hash, MIME, rozmiar, stan, zgłaszający |
| `asset_versions` | Oryginał/oczyszczona kopia, hash i niezmienna wersja, wynik skanowania, prywatny klucz, retencja |
| `asset_reviews` | Decyzja pracownika, wersja/hash, powody, czas, zakres inspekcji i dowody wewnętrzne |
| `opportunity_asset_grants` | Dokładna zatwierdzona kopia, okazja, odbiorca/firma, termin, cofnięcie i zatwierdzający |
| `asset_access_events` | Pobranie/odmowa/cofnięcie, użytkownik, wersja i czas; bez treści dokumentu |

RLS, ograniczone role bazy i backend wiążą plik z firmą, zasobem i konkretnym przydziałem. Klient nie może ustawiać właściciela, stanu skanowania, odznaki inspekcji ani odbiorców. Kupujący nie dostaje company ID dostawcy, kluczy storage, nazw źródłowych, OCR, CRM ID i wewnętrznych dowodów w JSON/HTML; nie wolno ich ukrywać dopiero w interfejsie.

Bucket oryginałów i bucket kopii są prywatne, bez publicznego listowania i odczytu. Preferowane pobranie przez uwierzytelnione API z aktualnym sprawdzeniem przydziału; ewentualny podpisany URL dla wewnętrznego pobrania przez BFF ma TTL do 60 s i nie zastępuje autoryzacji. Nie wysyłać przeglądarce trwałych URL. Miniatury i podglądy podlegają tym samym regułom. Odpowiedzi `private, no-store`, bez CDN/cache publicznego, z bezpiecznym typem i `nosniff`; PDF nie może uruchamiać aktywnej zawartości.

## Testy wymagane przed włączeniem

- Buyer A/B, Supplier A/B, Partner, niezatwierdzony i zawieszony użytkownik: próby obcego odczytu, zmiany klucza/firmy, pominięcia przeglądu i enumeracji nie ujawniają pliku ani jego istnienia.
- Błędny MIME, podwójne rozszerzenie, zbyt duży obraz/PDF, aktywna zawartość, testowy sygnał antywirusowy oraz awaria skanera nie przechodzą do publikacji.
- Fikcyjne identyfikatory w EXIF/GPS, OCR, QR, podpisie, metadanych i nazwie pliku są wykrywane oraz usuwane w kopii; źródło nigdy nie dociera do Buyer. Automatyczny brak ostrzeżenia nie pomija ręcznego przeglądu.
- Zmieniony hash, wygasły przydział, cofnięcie, zawieszenie i podmieniony obiekt blokują ponowne pobranie; log odnotowuje decyzję bez tokenów i poufnych treści.
- Ponowienia workerów są idempotentne. Test odtworzenia obejmuje pliki, metadane, przydziały, retencję i odrębne klucze, bez automatycznej ponownej publikacji materiałów z kwarantanny.

Najpierw bezpieczny staging i zatwierdzenie zasad, następnie implementacja na fikcyjnych materiałach. Upload na produkcji pozostaje wyłączony do osobnej decyzji właściciela.

## Powiązanie z Offers Workspace i RBAC

Obecne miejsce na galerię i dokumenty w Offers Workspace nie jest aktywnym uploadem. Dopiero zatwierdzona oczyszczona miniatura może zastąpić neutralny placeholder; brak materiału nie oznacza weryfikacji oferty. Galeria i lista dokumentów również wymagają paginacji i limitów odpowiedzi. Nie ładować źródeł wszystkich ofert do przeglądarki.

Przyszłe osobne kompetencje: przyjmowanie własnych materiałów, wewnętrzny odczyt oryginału, przegląd/redakcja, zatwierdzanie kopii, nadawanie odbiorcy i cofanie. Każda jest egzekwowana w API i RLS, zgodnie z indywidualnym zakresem pracownika; zwykłe prawo zatwierdzania oferty nie daje automatycznie wszystkich tych praw. Decyzje materiałowe trafiają do historii oferty i audytu. Członkostwo C.A.R.T.E.L. samo nie daje żadnej z tych kompetencji.
