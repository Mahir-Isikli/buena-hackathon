-- Buena ERP, demo D1 schema.
-- Stand-in for Buena's Postgres. The lookup adapter exposes the same
-- shape, so swapping the binding for production is a one-file change.
--
-- Drop in dependency order so re-runs are idempotent.
DROP TABLE IF EXISTS owner_units;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS service_providers;
DROP TABLE IF EXISTS owners;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS buildings;
DROP TABLE IF EXISTS properties;

CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strasse TEXT,
  plz TEXT,
  ort TEXT,
  land TEXT,
  baujahr INTEGER,
  sanierung INTEGER,
  verwalter TEXT,
  weg_bankkonto_iban TEXT,
  weg_bankkonto_bank TEXT,
  ruecklage_iban TEXT
);

CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  hausnr TEXT,
  einheiten INTEGER,
  etagen INTEGER,
  fahrstuhl INTEGER,
  baujahr INTEGER
);

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  haus_id TEXT NOT NULL REFERENCES buildings(id),
  einheit_nr TEXT,
  lage TEXT,
  typ TEXT,
  wohnflaeche_qm REAL,
  zimmer REAL,
  miteigentumsanteil INTEGER
);

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  anrede TEXT,
  vorname TEXT,
  nachname TEXT,
  firma TEXT,
  strasse TEXT,
  plz TEXT,
  ort TEXT,
  land TEXT,
  email TEXT,
  telefon TEXT,
  iban TEXT,
  bic TEXT,
  selbstnutzer INTEGER NOT NULL DEFAULT 0,
  sev_mandat INTEGER NOT NULL DEFAULT 0,
  beirat INTEGER NOT NULL DEFAULT 0,
  sprache TEXT
);

CREATE TABLE owner_units (
  owner_id TEXT NOT NULL REFERENCES owners(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  PRIMARY KEY (owner_id, unit_id)
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  anrede TEXT,
  vorname TEXT,
  nachname TEXT,
  email TEXT,
  telefon TEXT,
  einheit_id TEXT REFERENCES units(id),
  eigentuemer_id TEXT REFERENCES owners(id),
  mietbeginn TEXT,
  mietende TEXT,
  kaltmiete REAL,
  nk_vorauszahlung REAL,
  kaution REAL,
  iban TEXT,
  bic TEXT,
  sprache TEXT
);

CREATE TABLE service_providers (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  firma TEXT,
  branche TEXT,
  ansprechpartner TEXT,
  email TEXT,
  telefon TEXT,
  strasse TEXT,
  plz TEXT,
  ort TEXT,
  land TEXT,
  iban TEXT,
  bic TEXT,
  ust_id TEXT,
  steuernummer TEXT,
  stil TEXT,
  sprache TEXT,
  vertrag_monatlich REAL,
  stundensatz REAL
);

CREATE INDEX idx_buildings_property ON buildings(property_id);
CREATE INDEX idx_units_haus ON units(haus_id);
CREATE INDEX idx_owners_property ON owners(property_id);
CREATE INDEX idx_owners_email ON owners(email);
CREATE INDEX idx_owner_units_owner ON owner_units(owner_id);
CREATE INDEX idx_owner_units_unit ON owner_units(unit_id);
CREATE INDEX idx_tenants_property ON tenants(property_id);
CREATE INDEX idx_tenants_unit ON tenants(einheit_id);
CREATE INDEX idx_tenants_email ON tenants(email);
CREATE INDEX idx_providers_property ON service_providers(property_id);
CREATE INDEX idx_providers_email ON service_providers(email);
