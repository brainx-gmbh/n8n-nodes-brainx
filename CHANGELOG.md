# Changelog

All notable changes to this project are documented in this file.

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
