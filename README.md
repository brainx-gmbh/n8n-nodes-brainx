# n8n-nodes-brainx

This is an n8n community node. It lets you use [brainX](https://www.brainx.app/) in your n8n workflows.

brainX is a CRM platform by brainformatik. This node allows you to interact with brainX records directly from n8n.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) | [Operations](#operations) | [Credentials](#credentials) | [Compatibility](#compatibility) | [Resources](#resources) | [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

Most operations work against dynamically loaded **modules** (entities) from your brainX instance. A few operations target the user/account context instead and don't require a module selection.

### Record operations

- **Create** - Create a new record. Required fields are enforced based on module metadata. Supports uploading a file into a File field.
- **Delete** - Delete a record by ID.
- **Get** - Retrieve a single record by ID, or list all records if no ID is given.
  - Options: Include Deleted, Include File Content
- **Search** - Search and list records with optional filters, sorting, and field selection.
  - **Filters** - Add filter conditions with a field selector and operators: Contains (LIKE), Equals (Exact), Greater Than, Less Than, Not Equals, Not Equals (Exact). Supports multiple values per field (pipe-separated) and combining conditions with OR.
  - **Sort Order** - Sort by one or more fields in ascending or descending order.
  - **Fields to Return** - Select specific fields to include in the response.
  - Options: Include Deleted, Include File Content, Offset, Filter Combine With OR
- **Update** - Update an existing record by ID. No required fields are enforced. Supports uploading a file into a File field.

### Relation operations

- **Add Relations** - Relate one or more existing records to a given record (record IDs are globally unique, so the target entity is inferred by the server).
- **Get Relations** - List related records of a given record, grouped by entity.

### User / account operations

- **Get Current User** - Retrieve information about the currently logged-in user (`/api/users/current`).
- **Get Companies** - List companies the current user has access to (`/api/users/companies`). The available companies are configured per role under user settings by a privileged user.

### Escape hatch

- **Custom API Call** - Send an arbitrary request (GET/POST/PATCH/DELETE) using the configured credentials. The `/api/` prefix is added automatically when missing.

Field types (text, picklist, date, boolean, references) are automatically mapped from brainX metadata, with dropdown options loaded for picklist and reference fields.

## Credentials

This node authenticates using an **API Password**. You will need:

1. **Base URL** - The URL of your brainX instance
2. **Username** - Your brainX username
3. **API Password** - Your brainX API password

## Compatibility

Tested with n8n 2.17.x on Node.js 24.x. Requires Node.js 22+ (matching n8n's own requirement).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [brainX website](https://www.brainx.app/)

## Version history

### 0.3.0

- Changed **Custom API Call** body to a Key/Value field collection instead of a JSON text input, making it easier to compose request bodies without escaping JSON.
- Changed reference fields (`Reference`, `CompanyReference`) to plain number inputs instead of fetched dropdowns. This avoids extra API roundtrips and makes it simpler to pass IDs from upstream nodes.
- Simplified credential display name to `brainX API`.
- Normalized brand spelling to lowercase `brainX` in user-facing strings (display names, error messages).
- Fixed field label sorting so fields whose API label has leading whitespace (e.g. `Lieferung: PLZ`) no longer appear at the top of the list.

### 0.2.0

- Added **Get Current User** operation (`/api/users/current`).
- Added **Get Companies** operation (`/api/users/companies`).
- Added **Add Relations** and **Get Relations** operations.
- Added **Custom API Call** operation for arbitrary requests.
- Added file upload support for Create and Update operations.
- Fixed creating Potentials by sending the required currency/language/tax/discount fields.

### 0.1.0

Initial release with Create, Delete, Get, Search, and Update operations.
