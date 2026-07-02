# Changelog

All notable changes to this project are documented in this file.

## [0.3.10]

### Changed

- Remove GET Cache

## [0.3.9]

### Added

- NPM Publish
- Update Version

## [0.3.0]

### Changed

- Custom API Call body is now a Key/Value field collection instead of a JSON text input, making it easier to compose request bodies without escaping JSON.
- Reference fields (`Reference`, `CompanyReference`) are now plain number inputs instead of fetched dropdowns. This avoids extra API roundtrips and makes it simpler to pass IDs from upstream nodes.
- Credential display name simplified to `brainX API`.
- Brand spelling normalized to lowercase `brainX` in user-facing strings (display names, error messages).

### Fixed

- Field labels are trimmed before sorting, so fields whose API label has leading whitespace (e.g. `Lieferung: PLZ`) no longer appear at the top of the list.

## [0.2.0]

### Added

- **Get Current User** operation — retrieves information about the currently logged-in user via `/api/users/current`.
- **Get Companies** operation — lists companies the current user has access to via `/api/users/companies`. Available companies are configured per role under user settings.
- **Add Relations** operation — relate one or more existing records to a given record.
- **Get Relations** operation — list related records of a given record, grouped by entity.
- **Custom API Call** operation — send an arbitrary request (GET/POST/PATCH/DELETE) with the configured credentials.
- File upload support for Create and Update operations (binary or base64 source).

### Fixed

- Creating Potentials now sends the required currency, language, tax type, and discount fields.

## [0.1.0]

Initial release with Create, Delete, Get, Search, and Update operations.
