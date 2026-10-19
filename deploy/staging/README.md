# Staging — zachowany, niedokończony szkic

Publikacja jest wstrzymana decyzją właściciela. Te pliki zachowano w punkcie
kontrolnym; nie są gotowym ani przetestowanym wdrożeniem.

Brakuje `scripts/staging-migrate.mjs`, polecenia `staging:prepare` oraz generatora
plików konfiguracji, certyfikatów i bramy testerów. Dockerfile i Compose odwołują
się do tych brakujących elementów. Nie uruchamiać tego szkicu jako stagingu ani
produkcji. Działający lokalny stos pozostaje w `local/compose.yaml`.

Nie utworzono hostingu, nie zmieniono DNS i nie przeniesiono lokalnych kont ani
sekretów. Dalsze prace wymagają odrębnego polecenia właściciela.
