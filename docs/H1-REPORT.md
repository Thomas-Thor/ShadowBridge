# H1 — nawigacja i dostęp prywatny

Baza: `478568ec1821dfc4a643bce72402f641c9a546ad`. Wyłącznie gałąź
`feature/secure-b2b-mvp`; bez połączeń z Contabo i bez wdrożenia.

## H1-A

Dodano Member Access z oryginalną ikoną złotej bramy i osobnym arkuszem CSS.
Dotychczasowe menu, Let's talk, sekcje, formularze i symbol C.A.R.T.E.L. zachowano.
Na wąskim telefonie pozostaje widoczna ikona z dostępną nazwą Member Access.

**2/2 testy Chromium PASS**, szerokości 1440/1200/1024/1001/1000/768/390/320:
brak overflow, cel 44 px, klawiatura/Enter, menu mobilne/Escape, odnośniki do
Member Sign In, Legal i trzech Apply oraz istniejące kotwice. Axe w nagłówku:
brak naruszeń WCAG A/AA. To testy nawigacji statycznej, nie uwierzytelniania.
Nowe CSS/SVG dodano też do jawnej listy paczki statycznej; zbudowanie nowej
paczki i obecność obu plików sprawdzono bez nadpisywania wcześniejszych wyników.
