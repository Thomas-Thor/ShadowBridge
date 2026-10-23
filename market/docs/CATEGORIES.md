# Kategorie Market — wspólna klasyfikacja, bez migracji

Źródło: `supabase/migrations/202610190008_taxonomy.sql`. Migracja `010` poprawia egzekwowanie klasyfikacji, nie zmienia seeda. Przejrzano również `server/taxonomy.mjs` i formularze `assets/portal.js`. Market nie tworzy tabel ani nowego zestawu identyfikatorów.

`market/public/data/taxonomy.json` przechowuje dokładne ID, klucze, nazwy i relacje rodzic–dziecko 8 aktywnych kategorii/24 podkategorii oraz 5 walut. Techniczne `unclassified` nie trafia do publicznej listy. `npm --prefix market run taxonomy:check` wykrywa rozbieżności z seedem. `taxonomy:sync` odtwarza plik; zmiany rozmiaru seeda wymagają świadomego przeglądu ekstraktora.

To snapshot repozytorium, **nie odczyt bieżących ustawień prywatnej bazy**. Przyszła synchronizacja ma korzystać z zatwierdzonego publicznego kontraktu klasyfikacji, bez kopiowania rekordów prywatnych.

| Istniejący klucz | Nazwa publiczna bez zmiany | Istniejące podkategorie |
| --- | --- | --- |
| food-agriculture | Food & agriculture | Fresh produce; Grains & ingredients; Processed food |
| water-beverages | Water & beverages | Drinking water; Non-alcoholic beverages; Water treatment |
| machinery-equipment | Machinery & equipment | Industrial machinery; Agricultural equipment; Spare parts |
| industrial-supplies | Industrial supplies | Raw materials; Industrial consumables; Safety equipment |
| hotel-hospitality | Hotel & hospitality | Hotel equipment; Furniture & fittings; Hospitality consumables |
| energy-infrastructure | Energy & infrastructure | Energy equipment; Renewable energy; Construction & infrastructure |
| emergency-humanitarian | Emergency & humanitarian supplies | Emergency food & water; Humanitarian equipment; Shelter & relief supplies |
| other-opportunities | Other opportunities | Surplus stock; Special projects; Other goods & services |

Każdy rekord DEMO rozwiązuje klucz istniejącej podkategorii do jej ID i ID rodzica. Start nie powiedzie się przy brakującej klasyfikacji, zamiast przypisać domyślną kategorię. Waluty EUR/USD/GBP/NOK/PLN zachowują własne kwoty; bez przeliczeń i porównywania cen w różnych walutach.

Rodzaj oferty (`wholesale`, `stocklot`, `surplus`) jest odrębnym wymiarem filtrowania, **nie drugą taksonomią**. Nadwyżka maszyn może pozostać w Machinery. Sam profil firmy nie stanowi dowodu posiadania nadwyżek.

Liczniki kategorii uwzględniają tekst, kraj, rodzaj i walutę, ale celowo pomijają aktualną kategorię/podkategorię, aby pokazać alternatywy. Pozostałe kryteria łączą się przez AND; tekst jest wyszukiwaniem ciągu w nazwie towaru, firmy, lokalizacji, klasyfikacji i ID. Sortowanie: data, nazwa A–Z/Z–A lub kraj. Cena nie jest przeliczana ani sortowana między walutami.

## Propozycje na później — wymagają osobnej decyzji

Uzupełnić globalną klasyfikację o tekstylia/odzież, elektronikę, opakowania, chemię i materiały odzyskane. Rozważyć podkategorie w obecnych gałęziach zamiast kolejnych korzeni; przygotować kontrolę towarów regulowanych. Nie dodano tych kategorii do seeda ani bazy i nie przypisano do nich rekordów. Geografia jest osobnym kodem ISO, więc taksonomia nie ogranicza przyszłego rynku do Europy.
