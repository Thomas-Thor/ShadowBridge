# ShadowBridge V2 — podgląd offline

1. Pobierz ZIP gałęzi feature/shadowbridge-v2 i rozpakuj go na swoim komputerze.
2. Otwórz review/ShadowBridge-V2.html w Firefox, Chrome lub Edge.
3. Sprawdź menu, branże, wybór roli, formularz i stronę informacyjną Cartel.
4. Widok telefonu w Chrome/Edge: F12, Ctrl+Shift+M, szerokość 390 lub 320 px.

Oba pliki HTML zawierają fonty, grafiki i style; główna strona zawiera również JavaScript. Strona Cartel nie udostępnia logowania ani paneli. Formularz może otworzyć wiadomość do shadowbridge.trade@gmail.com w Twojej aplikacji pocztowej, pobrać brief lub skopiować jego treść. W aplikacji pocztowej sam sprawdzasz wiadomość i naciskasz Wyślij (Send). Strona sama nie wysyła wiadomości i nie tworzy kont. Jeśli zakodowany adres mailto przekracza 2000 znaków, użyj pobrania briefu lub kopiowania i przygotuj wiadomość ręcznie. Przy otwieraniu z dysku schowek i obsługa mailto zależą od przeglądarki oraz lokalnej aplikacji pocztowej.

Zarządzana przeglądarka środowiska Codex blokuje file://; bezpośrednie otwarcie dwuklikiem pozostaje tu niezweryfikowane. Testowany jest podgląd przez lokalny serwer. Jeżeli przeglądarka blokuje pliki lokalne, otwórz terminal w katalogu review i uruchom:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Otwórz http://127.0.0.1:8000/ShadowBridge-V2.html na swoim komputerze. Zatrzymanie serwera: Ctrl+C. Nie publikuje to strony w Internecie. Nie są wymagane npm, klucze API ani backend.

SOURCE-MANIFEST.json zawiera SHA256 źródeł i wygenerowanych plików HTML. Pole baseCommit wskazuje commit bazowy; workingTreeExport informuje o eksporcie z niezacommitowanymi zmianami. Dokładne eksportowane bajty identyfikują hashe źródeł. Eksport należy regenerować po zmianach źródeł poleceniem npm run export:review w v2.

FONT-LICENSES.txt należy zachować przy przekazywaniu eksportu. Eksporter nie usuwa plików PNG; desktop.png i mobile.png należy odświeżyć osobnym testem przeglądarkowym po zmianie wyglądu. Podgląd ma noindex/nofollow i nie wykonuje żądań API.
