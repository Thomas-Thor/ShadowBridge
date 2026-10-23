# M1 — raport testów i ograniczeń

Data: 23.10.2026. Zakres: wyłącznie samodzielny frontend Market, fikcyjne dane. Node.js 24.19.0, lokalny Chromium, istniejące narzędzia Playwright i axe. Przed testami: około 1,3 GB wolnego miejsca w `/workspace`, 17 GB w `/tmp`. Bez Dockera, instalowania zależności, baz i usług zewnętrznych.

## Wyniki końcowe

| Kontrola wykonana | Wynik |
| --- | --- |
| `npm --prefix market test` | **8/8 PASS** |
| Zgodność taksonomii ze źródłem | **PASS**: 8 korzeni, 24 podkategorie, 5 walut |
| Playwright: rzeczywisty lokalny serwer Market + Chromium | **8/8 PASS** |
| Cztery widoki przy 1440, 390, 320 px | **12/12 PASS**, brak poziomego przewijania, załadowane obrazy |
| axe: te 12 widoków + otwarty dialog | **0 naruszeń badanych reguł WCAG 2 A/AA i 2.1 A/AA** |
| Klawiatura | **PASS**: skip link, focus po nawigacji, menu/Escape, dialog/Tab/Shift+Tab/Escape i powrót fokusu |

Testy obejmują wyszukiwanie produktu, dostawcy, kraju, klasyfikacji i ID; łączone filtry, podkategorie, PLN, brak wyników, sortowanie, dwie strony po 9 rekordów, stabilność bez duplikatów, odświeżanie i Wstecz, przejścia oferta–dostawca, brak ceny/Incoterms, błędny rekord, niedostępność pliku klasyfikacji oraz próbę wstrzyknięcia HTML przez parametr URL. Wszystkie 18 ofert ma istniejącą ilustrację i poprawną klasyfikację.

Lokalny transport testowany HTTP, nie tylko analiza plików: publiczna allowlista, blokada prywatnych ścieżek i repozytorium, brak zapisujących metod, nagłówki CSP/noindex. Każdy scenariusz przeglądarkowy kontroluje błędy JS, brak wywołań zewnętrznych/prywatnego API/zapisujących metod oraz puste localStorage/sessionStorage. Nie wykorzystano fikcyjnych odpowiedzi backendu do deklarowania działającej integracji — **Market M1 nie ma backendu biznesowego**. Jedyny wymuszony błąd HTTP to jawny test 503 pliku taksonomii.

## Naprawione podczas kontroli

- Zbyt niski kontrast drobnych teal tekstów na jasnoszarym tle — osobny ciemniejszy kolor tekstu.
- Niespójność widocznego tekstu i nazw dostępnych linków — naturalne etykiety zamiast sprzecznych `aria-label`.
- Przejście Tab z końca dialogu do chrome przeglądarki — jawne zawijanie fokusu; natywny dialog zachowuje Escape i powrót do przycisku.
- Strzałki zależne od dostępności glifów fontu — własne ikony SVG.
- Niejednoznaczna jednostka ceny — cena za kg, parę, zestaw itd., zgodnie z ofertą.
- Ilustracje kategorii nie zawsze odpowiadały konkretnemu produktowi — dodano rysunki m.in. rękawic, łożysk, filtrów i oświetlenia.

W pierwszym przebiegu skany wykryły błędy kontrastu i etykiet. Jeden test mobilny został przerwany, ponieważ test oczekiwał na dekodowanie jeszcze niewczytanego obrazu lazy. W testach zdjęto lazy przed sprawdzaniem obrazów; w interfejsie pozostaje lazy loading. Powyższe wyniki dotyczą końcowego, ponownie wykonanego przebiegu po poprawkach, nie tych przerwanych prób.

## Artefakty i powtórzenie

Podczas kontroli zapisano 8 pełnych zrzutów: home/browse/offer/supplier przy 1440 i 320 px. Artefakty w środowisku wykonania: `/tmp/shadowbridge-market-m1-ui/screenshots/`; końcowy log: `/tmp/shadowbridge-market-m1-ui/browser-final.log`. Nie są częścią pakietu publicznego ani danymi klientów. Wygląd strony głównej, katalogu i szczegółów mobilnych dodatkowo obejrzano wizualnie.

W środowisku Codex uruchomiono z katalogu `market`:

```sh
node /workspace/ShadowBridge/v2/node_modules/@playwright/test/cli.js test --config tests/ui.config.cjs
```

Na innej maszynie z już dostępnymi narzędziami można wskazać ich katalog przez `SHADOWBRIDGE_TEST_MODULES`; config używa `/usr/bin/chromium`, jeśli istnieje, w przeciwnym razie przeglądarki dostarczonej przez Playwright. Nie instalowano narzędzi w ramach M1. Do zwykłego podglądu narzędzia testowe są zbędne.

## Ograniczenia — świadomie poza M1

Brak prawdziwych rejestracji, logowania Market, bazy ofert, wysyłki zapytań, płatności, uploadu i weryfikacji firm. Zdjęcia to wyraźnie oznaczone oryginalne ilustracje, nie fotografie produktów. Brak prawdziwych ocen dostawców, referencji, cen planów i obietnic dostępności towarów.

Nie testowano obciążenia rzeczywistej giełdy, SEO produkcyjnego, subdomeny, HTTPS, urządzeń fizycznych, Safari/Firefox ani czytnika ekranu. Automatyczne skany i testy klawiatury nie są certyfikacją pełnej zgodności WCAG. Nie wykonywano testów prywatnego backendu, bo nie został zmieniony ani podłączony. Nie wdrażano aplikacji i nie zmieniano żadnych kont, danych, DNS, Contabo, `main` ani produkcji.

Checkpoint: M1 gotowy do lokalnego przeglądu i decyzji o kolejnym zakresie. Nie jest gotową publiczną usługą przyjmującą rzeczywiste oferty lub użytkowników.
