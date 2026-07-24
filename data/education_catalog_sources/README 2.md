# Education catalog source snapshots

These public-domain snapshots are indexed locally by `education_catalog.repository` so onboarding autocomplete requests never send a user's query to an external data provider.

- `EDGE_PUBLICSCH_2324.csv.gz`: NCES EDGE Public School Locations 2023–24, derived from the Common Core of Data. Stable identifier: `NCESSCH`.
- `HD2024.zip`: NCES/IPEDS 2024 Directory Information. Stable identifier: `UNITID`.
- `CIPCode2020.csv.gz`: NCES Classification of Instructional Programs 2020. Six-digit program codes are used for major suggestions.

The generated `data/education_catalog.sqlite3` file is intentionally ignored by Git and is rebuilt from these snapshots when first needed.
