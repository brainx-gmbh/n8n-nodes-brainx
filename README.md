# n8n-nodes-brainx

This is an n8n community node. It lets you use [brainX](https://www.brainx.app/) in your n8n workflows.

brainX is a CRM platform by brainformatik. This node allows you to interact with brainX records directly from n8n.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) | [Operations](#operations) | [Credentials](#credentials) | [Compatibility](#compatibility) | [Resources](#resources) | [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

All operations work against dynamically loaded **modules** (entities) from your brainX instance.

- **Create** - Create a new record. Required fields are enforced based on module metadata.
- **Delete** - Delete a record by ID.
- **Get** - Retrieve a single record by ID, or list all records if no ID is given.
  - Options: Include Deleted, Include File Content
- **Search** - Search and list records with optional filters, sorting, and field selection.
  - **Filters** - Add filter conditions with a field selector and operators: Contains (LIKE), Equals (Exact), Greater Than, Less Than, Not Equals, Not Equals (Exact). Supports multiple values per field (pipe-separated) and combining conditions with OR.
  - **Sort Order** - Sort by one or more fields in ascending or descending order.
  - **Fields to Return** - Select specific fields to include in the response.
  - Options: Include Deleted, Include File Content, Offset, Filter Combine With OR
- **Update** - Update an existing record by ID. No required fields are enforced.

Field types (text, picklist, date, boolean, references) are automatically mapped from brainX metadata, with dropdown options loaded for picklist and reference fields.

## Credentials

This node supports two authentication methods:

- **API Password** - Authenticate using your brainX username and API password.
- **Basic Auth** - Authenticate using your brainX username and user password.

Both methods require:

1. **Base URL** - The URL of your brainX instance (e.g. `https://your-instance.brainx.app`)
2. **Username** - Your brainX username
3. **Password** - Either your API password or user password, depending on the method chosen

## Compatibility

Tested with n8n version 1.x. Requires Node.js 18+ (uses native `fetch`).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [brainX website](https://www.brainx.app/)

## Version history

### 0.1.0

Initial release with Create, Delete, Get, Search, and Update operations.
