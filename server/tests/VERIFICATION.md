# Wynik testów lokalnego MVP — 18.10.2026

Gałąź: `feature/secure-b2b-mvp`. Testowano rzeczywisty lokalny BFF na
`127.0.0.1:8088`, GoTrue, PostgreSQL i Mailpit. Użyto wyłącznie unikalnych,
fikcyjnych firm, adresów `.invalid` i losowych haseł trzymanych w pamięci.
Nie zastosowano atrap odpowiedzi API ani zastępczego uwierzytelniania.

| Zakres | Wynik |
|---|---|
| Konfiguracja bezpieczeństwa | 2/2 zaliczone |
| Integracja HTTP + rzeczywiste Auth + PostgreSQL/RLS | 13 scenariuszy i test nadrzędny; raport Node 14/14 zaliczone |
| Przeglądarka mobilna 390 i 320 px | 4/4 zaliczone, 16 sekund |
| Przeglądarka desktopowa 1440 px — Supplier, zarząd, Partner | 2/2 zaliczone, 18 sekund |

Potwierdzono weryfikację e-maila, integralność ponownego zgłoszenia, brak
prywatnego dostępu przed akceptacją, prawdziwe TOTP/AAL2 zarządu oraz odmowę
zarządzania przy AAL1. Role zapisują i zgłaszają własne oferty, RFQ i propozycje.
Akceptacja oferty nie udostępnia jej automatycznie: potrzebna jest zatwierdzona
anonimowa karta oraz konkretny przydział. Sprawdzono brak tożsamości dostawcy
w odpowiedzi dla kupującego, IDOR między firmami, izolację rozmów dwóch
kupujących przypisanych do tej samej karty, pośrednictwo ShadowBridge,
indywidualne prowizje, CSRF, cookies HttpOnly/SameSite, no-store, RLS oraz
natychmiastową blokadę zawieszonego konta z zachowaniem audytu.

Testy przeglądarkowe wykonały rzeczywistą rejestrację, otworzyły lokalny link
potwierdzający e-mail, sprawdziły stan oczekiwania, wylogowanie i ponowne
logowanie. Po ręcznej akceptacji przez API zarządu z rzeczywistym MFA interfejs
kupującego zapisał i zgłosił RFQ; zapis potwierdzono odczytem z rzeczywistego API.
Nie było przewijania poziomego ani tokenów w localStorage/sessionStorage.

Dwa dodatkowe scenariusze desktopowe potwierdziły działanie interfejsów
dostawcy, zarządu i partnera. Dostawca utworzył, zmienił i zgłosił ofertę.
Zarząd w rzeczywistej sesji AAL2 zaakceptował ją przez UI, przygotował anonimową
kartę i przydzielił konkretnemu kupującemu; odczyt odbiorcy nie zawierał danych
dostawcy. Partner zapisał profil, poprawnie odczytał listy krajów/sektorów po
odświeżeniu, zgłosił własną propozycję i zobaczył rzeczywiście przydzielony
projekt oraz osobno uzgodnioną prowizję. Nie zastosowano domyślnej stawki.

Pierwsze uruchomienia ujawniły jedynie zbyt wąskie oczekiwania testów:
unieważniona sesja AAL1 zwraca 401, RLS zwraca 404 przy próbie zmiany zgłoszonej
oferty, a potwierdzenie e-maila kieruje do oczekującego panelu. Asercje dopasowano
do tych prawidłowych zachowań i ponowiono tylko powiązane testy MVP.

Nie instalowano narzędzi przeglądarkowych, nie zmieniano produkcji, DNS ani
hostingu. Wiadomości trafiły do lokalnego Mailpit. Testy nie obejmowały
rzeczywistej dostarczalności e-maila na produkcji, zewnętrznego hostingu ani
produkcyjnej konfiguracji TLS; te usługi nie zostały uruchomione w tym etapie.
