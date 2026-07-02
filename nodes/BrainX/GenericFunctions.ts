import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	NodeOperationError,
} from 'n8n-workflow';

type BrainXContext = IExecuteFunctions | ILoadOptionsFunctions;

// ─── brainX API Types ─────────────────────────────────────────────────────────

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
	values?: BrainXPicklistValue[] | Record<string, string>;
	options?: BrainXPicklistValue[] | Record<string, string>;
	items?: BrainXPicklistValue[] | Record<string, string>;
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
];
const REFERENCE_TYPES = ['Reference', 'CompanyReference'];
export const DATE_TYPES = ['DateTime'];
export const BOOL_TYPES = ['Checkbox'];
const HIDDEN_TYPES = ['File', 'Image', 'Password', 'TaxClass', 'ModuleFieldType'];

async function getEntityNameById(
	this: BrainXContext,
	entityId: number,
): Promise<string | undefined> {
	const response = (await brainXApiRequest.call(this, 'GET', '/api/metadata/entities')) as {
		data?: BrainXEntity[];
	};
	return (response.data ?? []).find((e) => e.id === entityId)?.name;
}

// ─── Forced Required Fields ───────────────────────────────────────────────────
// Some modules have fields the API accepts only when provided but does not
// flag as required in its metadata. Keyed by entity name (stable across tenants).

const FORCED_REQUIRED_FIELDS: Record<string, string[]> = {
	Potentials: ['record_currency_id', 'record_language', 'hdnTaxType', 'basic_discount'],
};

export async function getForcedRequiredFieldsForEntity(
	this: BrainXContext,
	entityId: number,
): Promise<string[]> {
	const name = await getEntityNameById.call(this, entityId);
	return name ? (FORCED_REQUIRED_FIELDS[name] ?? []) : [];
}

// ─── Token Cache ─────────────────────────────────────────────────────────────
// Keyed by baseUrl + username so each user gets one token reused across calls.
// Kept short so the cached token is unlikely to outlive its server-side TTL;
// any gap is covered by the retry-on-401 in brainXApiRequest.

interface Cached<T> {
	data: T;
	expiresAt: number;
}
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min preemptive refresh
const tokenCache = new Map<string, Cached<string>>();

function tokenCacheKey(baseUrl: string, username: string): string {
	return `${baseUrl}\x00${username}`;
}

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
		throw new Error(`brainX authentication failed (${authRes.status}): ${authRes.statusText}`);
	}

	const json = (await authRes.json()) as Record<string, unknown>;
	const token = (json.accessToken ??
		(json.data as Record<string, unknown> | undefined)?.accessToken) as string | undefined;
	if (!token) {
		throw new Error(`brainX authentication: unexpected response – ${JSON.stringify(json)}`);
	}
	return token;
}

async function getAccessToken(baseUrl: string, credentials: IDataObject): Promise<string> {
	const cacheKey = tokenCacheKey(baseUrl, String(credentials.username));
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

	const buildInit = (accessToken: string): RequestInit => {
		const init: RequestInit = {
			method,
			headers: {
				'Content-Type': 'application/vnd.brainformatik.crm-v2+json',
				Authorization: `Bearer ${accessToken}`,
			},
		};
		if (Object.keys(body).length) {
			init.body = JSON.stringify(body);
		}
		return init;
	};

	// Execute with cached token; on 401, evict + retry once with a fresh token.
	// Covers server-side invalidation (restart, manual revoke, shorter TTL than assumed).
	let fetchInit = buildInit(await getAccessToken(baseUrl, credentials));
	let res = await fetch(fullUrl, fetchInit);
	if (res.status === 401) {
		tokenCache.delete(tokenCacheKey(baseUrl, String(credentials.username)));
		fetchInit = buildInit(await getAccessToken(baseUrl, credentials));
		res = await fetch(fullUrl, fetchInit);
	}

	if (!res.ok) {
		const errorBody = await res.text().catch(() => '');
		throw new Error(
			`brainX API error ${res.status}: ${res.statusText} | body: ${errorBody} | request: ${fetchInit.body ?? '(none)'}`,
		);
	}

	return (await res.json()) as IDataObject;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function fetchFields(this: BrainXContext, entityId: number): Promise<BrainXField[]> {
	const metadata = await brainXApiRequest.call(this, 'GET', `/api/metadata/entities/${entityId}`);
	const fields = ((metadata.data as Record<string, unknown> | undefined)?.fields ??
		(metadata as Record<string, unknown>).fields) as BrainXField[] | undefined;

	if (!fields) {
		throw new Error(`fetchFields: unexpected response shape – ${JSON.stringify(metadata)}`);
	}
	for (const f of fields) {
		if (typeof f.label === 'string') f.label = f.label.trim();
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
	if (REFERENCE_TYPES.includes(brainXType)) return 'number';
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

// ─── Required Field Validation ────────────────────────────────────────────────

export async function validateRequiredFields(
	this: IExecuteFunctions,
	entityId: number,
	body: IDataObject,
): Promise<void> {
	const fields = await fetchFields.call(this, entityId);
	const forced = new Set(await getForcedRequiredFieldsForEntity.call(this, entityId));

	const requiredNames = new Set<string>([
		...fields.filter((f) => f.required).map((f) => f.name),
		...forced,
	]);

	const missing = Array.from(requiredNames)
		.filter((name) => !(name in body))
		.map((name) => fields.find((f) => f.name === name)?.label ?? name);

	if (missing.length > 0) {
		throw new NodeOperationError(this.getNode(), `Missing required fields: ${missing.join(', ')}`);
	}
}
