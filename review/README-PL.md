# ShadowBridge V2 — podgląd offline

Źródłowy commit: `d6eabed1e6774b8e1140ca335e00f906341664b5` na `feature/shadowbridge-v2`.

1. Pobierz i rozpakuj cały ZIP gałęzi na swoim komputerze.
2. Wejdź do folderu `review`.
3. Otwórz `ShadowBridge-V2.html` dwuklikiem w Chrome, Edge lub Firefox.
4. Przewiń wszystkie sekcje. Sprawdź menu, wybór branży, ścieżki buyer/supplier/agent i formularz pobierający lokalny brief.
5. Aby sprawdzić układ telefonu w Chrome/Edge: F12 → pasek urządzeń (Ctrl+Shift+M, na macOS Cmd+Shift+M), szerokość390 lub320px, następnie odśwież.

Ten plik ma osadzone fonty, grafiki, CSS i JavaScript. Nie wymaga Pythona, npm, serwera, kluczy API ani dostępu do sieci. To eksport istniejącego V2, bez zmiany projektu. Metadane i treść pochodzą z wersji źródłowej.

Eksport sprawdzono w Chromium po HTTP: wygląd identyczny piksel w piksel ze źródłowym V2 przy1440/768/390/320px; menu, branże, wybór roli i pobranie briefu działają, bez dodatkowych żądań sieciowych. Zarządzana przeglądarka tego środowiska blokuje adresy `file://`, więc bezpośrednie otwarcie pliku z dysku nie zostało tu zweryfikowane. Jeżeli również Twoja przeglądarka firmowa blokuje pliki lokalne, uruchom poniższe polecenie w pobranym folderze `review`:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Na Windows z Python Launcher użyj `py -m http.server 8000 --bind 127.0.0.1`. W swojej przeglądarce otwórz `http://127.0.0.1:8000/ShadowBridge-V2.html`. Jest to serwer na Twoim komputerze, nie niedostępny adres środowiska Codex. Zatrzymanie: Ctrl+C. Nie wykonuje publikacji w Internecie.

Formularz wyłącznie pobiera lub kopiuje lokalny brief. Niczego nie wysyła i nie rejestruje kont. Dostęp do schowka przy otwarciu pliku z dysku zależy od przeglądarki; w razie odmowy użyj pobrania briefu. Zmiany w formularzu nie są zapisywane po zamknięciu strony.

`desktop.png` i `mobile.png` to rzeczywiste zrzuty z przeglądarki, a nie wygenerowane wizualizacje. Dołączony `FONT-LICENSES.txt` zawiera licencje fontów. Nie oddzielaj go od eksportu przy dalszym przekazywaniu.

Eksport nie zawiera paneli. Pełne źródła i testy są w pozostałych folderach repozytorium. Otwieranie `v2/index.html` bez serwera nie zastępuje tego samowystarczalnego eksportu.

Nie uruchamia to publikacji na `shadow-bridge.eu` i nie wymaga zmian DNS.
