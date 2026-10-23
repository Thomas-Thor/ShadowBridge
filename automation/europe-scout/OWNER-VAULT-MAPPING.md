# OWNER VAULT — mapowanie, integracja WYŁĄCZONA

Fundament: migracja `016` i `server/owner-vault.mjs` z gałęzi
`feature/secure-b2b-mvp` (baza `6d200ee084872b6c3123346e2f77c61010c94049`).
Nie zmieniono schematu, API, RBAC, RLS, MFA ani danych Vault. Workflow nie zna jego
adresu, sesji OWNER, tokenów administratora ani poświadczeń PostgreSQL.

| Pole pilota | Kandydat do przyszłego kontraktu |
|---|---|
| `legalName` | `company.name` — V1 ma limit 200 znaków; ewentualny konflikt wymaga przeglądu, nie cichego obcięcia |
| `country` | `company.country` (ISO alpha-2) |
| `registrationNumber` | `company.registrationNumber` |
| `activityCodes` | `company.sector` po zatwierdzonym mapowaniu wersji klasyfikacji; pełne kody w provenance V3 |
| `website` | `company.website` tylko jeśli przejdzie walidację kanonicznego HTTPS V1; nie podmieniamy automatycznie HTTP na HTTPS |
| `source.system` | `source.system` (`brreg-enhetsregisteret` / `ares`) |
| `source.recordId` | `source.recordId` |
| `source.url` | `source.url` — kanoniczny oficjalny HTTPS rekordu |
| `city`, `legalForm`, `acquiredAt`, klasyfikacja, potencjał współpracy | Dodatkowe firmowe provenance V3; nie wysyłać jako nieobsługiwane pola do API V1 |
| `key` (`country:registry ID`) | Stabilna tożsamość firmy + klucz idempotencji przyszłego firmowego intake |
| `status` | Nie przenosi decyzji członkowskiej ani automatycznej oceny zaufania; `unconfirmed`/`review_required` |

**Istotna niezgodność:** istniejący `POST /api/owner/vault/contacts` wymaga
`record.contact.fullName`. Scout gromadzi firmy, nie osoby. Nie można wysłać jego
rekordu do V1 bez wymyślenia osoby, co jest zabronione. **Nie ma automatycznego
eksportu ani gotowego payloadu udającego zgodność z tym endpointem.**

Osobny V3 musi najpierw zatwierdzić company-only intake/provenance, retencję,
podstawę przetwarzania, aktualne źródła/licencje i deduplikację. Dopiero potem
możliwa będzie brama z minimalnym zakresem zapisu per-agent i audytem, bez praw
odczytu prywatnego CRM i bez sesji OWNER. Nie przyznawać n8n uprawnień do tabel
Vault. Weryfikacja istnienia firmy nie weryfikuje osoby, prawa do jej reprezentacji,
nadwyżek, towaru ani relacji z ShadowBridge.

Pilot jest ograniczonym buforem kwalifikacji, nie konkurencyjnym CRM. Nie łączy
rekordów po podobnej nazwie, nie nadpisuje istniejących firm i nie ingeruje
w prywatny OWNER VAULT właściciela.
