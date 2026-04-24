import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	NodeOperationError,
} from 'n8n-workflow';

type BrainXContext = IExecuteFunctions | ILoadOptionsFunctions;

// ─── BrainX API Types ─────────────────────────────────────────────────────────

export interface BrainXEntity {
	id: number;
	name: string;
	label: string;
	singular: string;
	icon: string;
	isEntity: boolean;
	isInventory: boolean;
	create: boolean;
	update: boolean;
	delete: boolean;
	readonly: boolean;
	nameFields: string[];
	views: Array<{ id: number; name: string; default: boolean }>;
}

interface BrainXPicklistValue {
	label?: string;
	name?: string;
	value?: string | number;
	id?: string | number;
	key?: string;
}

export interface BrainXField {
	name: string;
	label?: string;
	type: string;
	required?: boolean;
	editable?: boolean;
	refEntities?: string[];
	refEntity?: string;
	values?: BrainXPicklistValue[] | Record<string, string>;
	options?: BrainXPicklistValue[] | Record<string, string>;
	items?: BrainXPicklistValue[] | Record<string, string>;
}

export interface BrainXRecord {
	id: number;
	recordName?: string; // present in list responses only
	[key: string]: unknown;
}

interface BrainXRecordsResponse {
	data: BrainXRecord[];
	metadata: {
		total: number;
		actual: number;
		editable: number[];
		deletable: number[];
		deleted: number[];
	};
}

export interface BrainXSingleRecordResponse {
	data: IDataObject;
	metadata: {
		editable: boolean;
		deletable: boolean;
	};
}

// ─── Field Type Categories ────────────────────────────────────────────────────

export const TEXT_TYPES = [
	'Text',
	'Textarea',
	'Email',
	'Phone',
	'URL',
	'Skype',
	'Number',
	'Currency',
	'Percentage',
];
export const PICKLIST_TYPES = [
	'PickList',
	'MultiPickList',
	'LanguagePickList',
	'UsersGroupsReference',
	'RoleReference',
	'Reference',
	'CompanyReference',
];
export const DATE_TYPES = ['DateTime'];
export const BOOL_TYPES = ['Checkbox'];
const HIDDEN_TYPES = ['File', 'Image', 'Password', 'TaxClass', 'ModuleFieldType'];

async function getEntityIdByName(
	this: BrainXContext,
	entityName: string,
): Promise<number | undefined> {
	const response = (await brainXApiRequest.call(this, 'GET', '/api/metadata/entities')) as {
		data?: BrainXEntity[];
	};
	// Don't filter by isEntity — reference fields can point to system modules (e.g. Currencies)
	return (response.data ?? []).find((e) => e.name === entityName)?.id;
}

// ─── Token Cache ─────────────────────────────────────────────────────────────
// Keyed by baseUrl + username so each user gets one token reused across calls.
// Refreshed 5 min before assumed expiry to avoid mid-flight invalidation.

interface Cached<T> {
	data: T;
	expiresAt: number;
}
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 min (assumes ≥1 h server-side lifetime)
const GET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min for GET responses (metadata, records)
const tokenCache = new Map<string, Cached<string>>();
const getCache = new Map<string, Cached<IDataObject>>();

// ─── Generic API Request ──────────────────────────────────────────────────────
// Uses fetch directly (same as credentials) to avoid n8n context limitations
// in both IExecuteFunctions and ILoadOptionsFunctions.

async function fetchAccessToken(baseUrl: string, credentials: IDataObject): Promise<string> {
	const authRes = await fetch(`${baseUrl}/api/auth`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/vnd.brainformatik.crm-v2+json' },
		body: JSON.stringify({
			user: String(credentials.username),
			apiPassword: String(credentials.apiPassword),
		}),
	});

	if (!authRes.ok) {
		throw new Error(`BrainX authentication failed (${authRes.status}): ${authRes.statusText}`);
	}

	const json = (await authRes.json()) as Record<string, unknown>;
	const token = (json.accessToken ??
		(json.data as Record<string, unknown> | undefined)?.accessToken) as string | undefined;
	if (!token) {
		throw new Error(`BrainX authentication: unexpected response – ${JSON.stringify(json)}`);
	}
	return token;
}

async function getAccessToken(baseUrl: string, credentials: IDataObject): Promise<string> {
	const cacheKey = `${baseUrl}\x00${String(credentials.username)}`;
	const cached = tokenCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) return cached.data;

	const token = await fetchAccessToken(baseUrl, credentials);
	tokenCache.set(cacheKey, { data: token, expiresAt: Date.now() + TOKEN_TTL_MS });
	return token;
}

export async function brainXApiRequest(
	this: BrainXContext,
	method: string,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
	rawQs?: string,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('brainXApi');
	const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');

	// Build URL + query string
	const url = new URL(`${baseUrl}${endpoint}`);
	for (const [k, v] of Object.entries(qs)) {
		url.searchParams.set(k, String(v));
	}
	let fullUrl = url.toString();
	if (rawQs) {
		fullUrl += (fullUrl.includes('?') ? '&' : '?') + rawQs;
	}

	// Return cached response for GET requests (metadata, records, etc.)
	if (method === 'GET') {
		const cached = getCache.get(fullUrl);
		if (cached && Date.now() < cached.expiresAt) return cached.data;
	}

	const accessToken = await getAccessToken(baseUrl, credentials);

	const fetchInit: RequestInit = {
		method,
		headers: {
			'Content-Type': 'application/vnd.brainformatik.crm-v2+json',
			Authorization: `Bearer ${accessToken}`,
		},
	};
	if (Object.keys(body).length) {
		fetchInit.body = JSON.stringify(body);
	}

	const res = await fetch(fullUrl, fetchInit);
	if (!res.ok) {
		const errorBody = await res.text().catch(() => '');
		throw new Error(
			`BrainX API error ${res.status}: ${res.statusText} | body: ${errorBody} | request: ${fetchInit.body ?? '(none)'}`,
		);
	}

	const result = (await res.json()) as IDataObject;

	if (method === 'GET') {
		getCache.set(fullUrl, { data: result, expiresAt: Date.now() + GET_CACHE_TTL_MS });
	}

	return result;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function fetchFields(this: BrainXContext, entityId: number): Promise<BrainXField[]> {
	const metadata = await brainXApiRequest.call(this, 'GET', `/api/metadata/entities/${entityId}`);
	const fields = ((metadata.data as Record<string, unknown> | undefined)?.fields ??
		(metadata as Record<string, unknown>).fields) as BrainXField[] | undefined;

	if (!fields) {
		throw new Error(`fetchFields: unexpected response shape – ${JSON.stringify(metadata)}`);
	}
	return fields;
}

export function isEditable(f: BrainXField): boolean {
	return f.editable !== false && !HIDDEN_TYPES.includes(f.type);
}

// ─── ResourceMapper Field Type Mapping ───────────────────────────────────────
// Maps brainX field types to the n8n resourceMapper FieldType

export function mapBrainXType(brainXType: string): string {
	if (brainXType === 'Number' || brainXType === 'Currency' || brainXType === 'Percentage') {
		return 'number';
	}
	if (PICKLIST_TYPES.includes(brainXType)) return 'options';
	if (DATE_TYPES.includes(brainXType)) return 'dateTime';
	if (BOOL_TYPES.includes(brainXType)) return 'boolean';
	return 'string';
}

// ─── Picklist Options for ResourceMapper ──────────────────────────────────────
// Called once per field when getMappingColumns loads — no heuristic needed.

export async function getPicklistOptionsForMapper(
	this: BrainXContext,
	field: BrainXField,
): Promise<Array<{ name: string; value: string | number | boolean }>> {
	if (field.type === 'Reference') {
		const refs: string[] = Array.isArray(field.refEntities)
			? field.refEntities
			: field.refEntity
				? [field.refEntity]
				: [];
		return loadReferenceOptions.call(this, refs);
	}

	if (field.type === 'CompanyReference') {
		return loadCompaniesOptions.call(this);
	}

	// Standard PickList / MultiPickList / LanguagePickList
	const rawValues = field.values ?? field.options ?? field.items ?? [];

	if (Array.isArray(rawValues)) {
		return rawValues.map((v) => ({
			name: String(v.label ?? v.name ?? v.value ?? v.id ?? v.key),
			value: String(v.value ?? v.id ?? v.key ?? v.label),
		}));
	}

	// Object format: { key: label, ... } or { key: { value, label }, ... }
	if (typeof rawValues === 'object' && rawValues !== null) {
		return Object.entries(rawValues as Record<string, unknown>).map(([k, v]) => {
			if (typeof v === 'object' && v !== null && 'value' in v) {
				const obj = v as { value: string; label?: string };
				return { name: String(obj.label ?? obj.value), value: String(obj.value) };
			}
			return { name: String(v), value: k };
		});
	}

	return [];
}

// ─── Internal Reference / Users Loaders ───────────────────────────────────────

export async function loadReferenceOptions(
	this: BrainXContext,
	refEntities: string[],
): Promise<Array<{ name: string; value: string }>> {
	const results: Array<{ name: string; value: string }> = [];

	for (const refEntity of refEntities) {
		const entityId = await getEntityIdByName.call(this, refEntity);
		if (!entityId) continue;
		const response = (await brainXApiRequest.call(
			this,
			'GET',
			`/api/entity/${entityId}/records`,
		)) as unknown as BrainXRecordsResponse;
		for (const r of response.data ?? []) {
			results.push({ name: r.recordName ?? String(r.id), value: String(r.id) });
		}
	}

	return results;
}

export async function loadCompaniesOptions(
	this: BrainXContext,
): Promise<Array<{ name: string; value: string }>> {
	const response = (await brainXApiRequest.call(this, 'GET', '/api/users/companies')) as {
		data?: Array<{ id: string | number; name: string }>;
	};
	return (response.data ?? []).map((c) => ({ name: c.name, value: String(c.id) }));
}

// ─── Required Field Validation ────────────────────────────────────────────────

export async function validateRequiredFields(
	this: IExecuteFunctions,
	entityId: number,
	body: IDataObject,
): Promise<void> {
	const fields = await fetchFields.call(this, entityId);
	const missing = fields
		.filter((f) => f.required && !(f.name in body))
		.map((f) => f.label ?? f.name);

	if (missing.length > 0) {
		throw new NodeOperationError(this.getNode(), `Missing required fields: ${missing.join(', ')}`);
	}
}
