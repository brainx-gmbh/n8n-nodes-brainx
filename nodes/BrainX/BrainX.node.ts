import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';

import {
	brainXApiRequest,
	BrainXEntity,
	BrainXSingleRecordResponse,
	fetchFields,
	getForcedRequiredFieldsForEntity,
	getPicklistOptionsForMapper,
	isEditable,
	mapBrainXType,
	PICKLIST_TYPES,
	validateRequiredFields,
} from './GenericFunctions';

// Row schema shared by createFiles/updateFiles. Brain X file payload shape:
//   { [fieldName]: { name: string, content: string /* base64 */ } }
const fileRowValues: INodeProperties[] = [
	{
		displayName: 'Field Name or ID',
		name: 'field',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getFileFields',
			loadOptionsDependsOn: ['resource'],
		},
		default: '',
		description:
			'The File field to upload to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Source',
		name: 'source',
		type: 'options',
		options: [
			{ name: 'Binary Data', value: 'binary' },
			{ name: 'Base64 String', value: 'base64' },
		],
		default: 'binary',
	},
	{
		displayName: 'Binary Property',
		name: 'binaryProperty',
		type: 'string',
		displayOptions: { show: { source: ['binary'] } },
		default: 'data',
		description: 'Name of the binary property on the incoming item that holds the file',
	},
	{
		displayName: 'Base64 Content',
		name: 'base64Content',
		type: 'string',
		displayOptions: { show: { source: ['base64'] } },
		default: '',
		description: 'Base64-encoded file content',
	},
	{
		displayName: 'MIME Type',
		name: 'mimeType',
		type: 'string',
		displayOptions: { show: { source: ['base64'] } },
		default: '',
		placeholder: 'application/pdf',
		description:
			'MIME type of the file. Used to append a file extension to the file name if missing.',
	},
	{
		displayName: 'File Name',
		name: 'fileName',
		type: 'string',
		default: '',
		description:
			"Optional override for the file name. If empty and Source is Binary Data, the binary item's file name is used. Required when Source is Base64 String.",
	},
];

export class BrainX implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'brainX',
		name: 'brainX',
		icon: 'file:brainx.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with the brainX APP',
		defaults: { name: 'brainX' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'brainXApi',
				required: true,
			},
		],
		properties: [
			// ── Operation ─────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Add Relations',
						value: 'addRelations',
						action: 'Add relations to a record',
						description: 'Relate other records to this record',
					},
					{
						name: 'Create',
						value: 'create',
						action: 'Create a record',
						description: 'Create a new record',
					},
					{
						name: 'Custom API Call',
						value: 'customApiCall',
						action: 'Make a custom API call',
						description: 'Send an arbitrary request with the configured credentials',
					},
					{
						name: 'Delete',
						value: 'delete',
						action: 'Delete a record',
						description: 'Delete a record by ID',
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get a record',
						description: 'Retrieve a record by ID, or list all if no ID given',
					},
					{
						name: 'Get Companies',
						value: 'getCompanies',
						action: 'Get accessible companies',
						description:
							'List companies the current user has access to. The available companies are configured per role under user settings.',
					},
					{
						name: 'Get Current User',
						value: 'getCurrentUser',
						action: 'Get current user',
						description: 'Retrieve information about the currently logged-in user',
					},
					{
						name: 'Get Relations',
						value: 'getRelations',
						action: 'Get relations of a record',
						description: 'List related records grouped by entity',
					},
					{
						name: 'Search',
						value: 'search',
						action: 'Search records',
						description: 'Search / list records with optional filters',
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update a record',
						description: 'Update an existing record',
					},
				],
				default: 'search',
			},

			// ── Resource ──────────────────────────────────────────────────────
			{
				displayName: 'Module Name or ID',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				typeOptions: {
					loadOptionsMethod: 'getEntities',
					loadOptionsDependsOn: ['operation'],
				},
				displayOptions: {
					hide: {
						operation: [
							'addRelations',
							'customApiCall',
							'getCompanies',
							'getCurrentUser',
							'getRelations',
						],
					},
				},
				default: '',
				description:
					'The entity type to work with. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},

			// ── Record ID ─────────────────────────────────────────────────────
			{
				displayName: 'Record ID',
				name: 'recordId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['addRelations', 'delete', 'get', 'getRelations', 'update'],
					},
				},
				default: '',
				description: 'The ID of the record. Leave empty on Get to return all records.',
			},

			// ── Add Relations: Related Record IDs ─────────────────────────────
			{
				displayName: 'Related Record IDs',
				name: 'relatedRecordIds',
				type: 'string',
				displayOptions: { show: { operation: ['addRelations'] } },
				default: '',
				required: true,
				placeholder: '1856, 1857, 1858',
				description:
					'Comma-separated list of record IDs to relate to this record. Brain X record IDs are globally unique, so the target entity is inferred by the server.',
			},

			// ── Custom API Call ───────────────────────────────────────────────
			{
				displayName: 'Method',
				name: 'customMethod',
				type: 'options',
				displayOptions: { show: { operation: ['customApiCall'] } },
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
				],
				default: 'GET',
			},
			{
				displayName: 'Endpoint',
				name: 'customEndpoint',
				type: 'string',
				displayOptions: { show: { operation: ['customApiCall'] } },
				default: '',
				required: true,
				placeholder: '/users/current',
				description:
					'Path to call relative to /api (e.g. /users/current → /api/users/current). /api/ is prepended automatically when missing. Include query string here if needed.',
			},
			{
				displayName: 'Body',
				name: 'customBody',
				type: 'json',
				typeOptions: { rows: 6 },
				displayOptions: {
					show: { operation: ['customApiCall'], customMethod: ['PATCH', 'POST'] },
				},
				default: '{}',
				description: 'JSON body to send with the request',
			},

			// ── Fields (resourceMapper) ───────────────────────────────────────
			// n8n resourceMapper automatically shows the right input per field type:
			//   string/number  → text input
			//   options        → dropdown with the field's picklist values
			//   dateTime       → date/time picker
			//   boolean        → toggle
			// Required fields are marked with *.
			// No "Value Type" selector needed — type is derived from the brainX metadata.
			// Split into two parameters (createFields / updateFields) so switching
			// operation clears the selection — n8n tracks resourceMapper state by
			// parameter name.
			{
				displayName: 'Fields',
				name: 'createFields',
				type: 'resourceMapper',
				displayOptions: { show: { operation: ['create'] } },
				default: { mappingMode: 'defineBelow', value: null },
				noDataExpression: true,
				typeOptions: {
					resourceMapper: {
						resourceMapperMethod: 'getMappingColumns',
						mode: 'add',
						fieldWords: { singular: 'Field', plural: 'Fields' },
						addAllFields: false,
						multiKeyMatch: false,
					},
				},
				description: 'Select the fields to set. Required fields are marked with *.',
			},
			{
				displayName: 'Fields',
				name: 'updateFields',
				type: 'resourceMapper',
				displayOptions: { show: { operation: ['update'] } },
				default: { mappingMode: 'defineBelow', value: null },
				noDataExpression: true,
				typeOptions: {
					resourceMapper: {
						resourceMapperMethod: 'getMappingColumns',
						mode: 'add',
						fieldWords: { singular: 'Field', plural: 'Fields' },
						addAllFields: false,
						multiKeyMatch: false,
					},
				},
				description: 'Select the fields to update',
			},

			// ── File (create/update) ──────────────────────────────────────────
			// One file per upload — the brainX API accepts a single file per request.
			{
				displayName: 'File',
				name: 'createFiles',
				type: 'fixedCollection',
				displayOptions: { show: { operation: ['create'] } },
				default: {},
				placeholder: 'Add File',
				options: [{ displayName: 'File', name: 'file', values: fileRowValues }],
			},
			{
				displayName: 'File',
				name: 'updateFiles',
				type: 'fixedCollection',
				displayOptions: { show: { operation: ['update'] } },
				default: {},
				placeholder: 'Add File',
				options: [{ displayName: 'File', name: 'file', values: fileRowValues }],
			},

			// ── Search: Limit ─────────────────────────────────────────────────
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 200 },
				displayOptions: { show: { operation: ['search'] } },
				default: 50,
				description: 'Max number of results to return',
			},

			// ── Search: Filters ───────────────────────────────────────────────
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				displayOptions: { show: { operation: ['search'] } },
				default: {},
				options: [
					{
						displayName: 'Conditions',
						name: 'conditions',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'field',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getFilterFields',
									loadOptionsDependsOn: ['resource'],
								},
								default: '',
								description: 'The field to filter on. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
							},
							{
								displayName: 'Operator',
								name: 'operator',
								type: 'options',
								options: [
									{ name: 'Contains (LIKE)', value: 'contains' },
									{ name: 'Equals (Exact)', value: 'exact' },
									{ name: 'Greater Than', value: 'gt' },
									{ name: 'Less Than', value: 'lt' },
									{ name: 'Not Equals', value: 'notEquals' },
									{ name: 'Not Equals (Exact)', value: 'notExact' },
								],
								default: 'contains',
								description: 'The comparison operator',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									'The value to compare against. Separate multiple values with | for OR matching within this field.',
							},
						],
					},
				],
			},

			// ── Search: Sort Order ────────────────────────────────────────────
			{
				displayName: 'Sort Order',
				name: 'sortOrder',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				displayOptions: { show: { operation: ['search'] } },
				default: {},
				options: [
					{
						displayName: 'Sort Fields',
						name: 'sortFields',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'field',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getFilterFields',
									loadOptionsDependsOn: ['resource'],
								},
								default: '',
								description: 'The field to sort by. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
							},
							{
								displayName: 'Direction',
								name: 'direction',
								type: 'options',
								options: [
									{ name: 'Ascending', value: 'ASC' },
									{ name: 'Descending', value: 'DESC' },
								],
								default: 'ASC',
								description: 'The sort direction',
							},
						],
					},
				],
			},

			// ── Search: Additional Options ────────────────────────────────────
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				displayOptions: { show: { operation: ['search'] } },
				default: {},
				options: [
					{
						displayName: 'Fields to Return',
						name: 'fields',
						type: 'multiOptions',
						typeOptions: {
							loadOptionsMethod: 'getFieldsToReturn',
							loadOptionsDependsOn: ['resource'],
						},
						default: [],
						description: 'Fields to include in the response. If none selected, all fields are returned. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Filter Combine With OR',
						name: 'filterOr',
						type: 'boolean',
						default: false,
						description: 'Whether to combine filter conditions (or groups) with OR instead of AND',
					},
					{
						displayName: 'Include Deleted',
						name: 'includeDeleted',
						type: 'boolean',
						default: false,
						description: 'Whether to include records in the recycle bin',
					},
					{
						displayName: 'Include File Content',
						name: 'includeFileContent',
						type: 'boolean',
						default: false,
						description:
							'Whether to include content of file fields. This might be very slow depending on file sizes and the limit parameter.',
					},
					{
						displayName: 'Offset',
						name: 'offset',
						type: 'number',
						default: 0,
						description: 'Number of records to skip (for pagination)',
					},
				],
			},

			// ── Get: Additional Options ───────────────────────────────────────
			{
				displayName: 'Additional Options',
				name: 'getOptions',
				type: 'collection',
				placeholder: 'Add Option',
				displayOptions: { show: { operation: ['get'] } },
				default: {},
				options: [
					{
						displayName: 'Include Deleted',
						name: 'includeDeleted',
						type: 'boolean',
						default: false,
						description: 'Whether to include records in the recycle bin',
					},
					{
						displayName: 'Include File Content',
						name: 'includeFileContent',
						type: 'boolean',
						default: false,
						description:
							'Whether to include content of file fields. This might be very slow depending on file sizes.',
					},
				],
			},
		],
		usableAsTool: true,
	};

	// ── Methods ────────────────────────────────────────────────────────────────

	methods = {
		loadOptions: {
			async getEntities(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const operation = this.getCurrentNodeParameter('operation') as string;
				const isWrite = operation === 'create' || operation === 'update';
				const isRead = operation === 'search' || operation === 'get';

				const response = (await brainXApiRequest.call(this, 'GET', '/api/metadata/entities')) as {
					data?: BrainXEntity[];
				};
				return (response.data ?? [])
					.filter((e) => e.isEntity)
					.filter((e) => !['Users', 'PlannedActions'].includes(e.name))
					.filter((e) => !isWrite || !e.isInventory || e.name === 'Potentials')
					.filter((e) => !isRead || e.name !== 'EmailsLocal')
					.map((e) => ({ name: e.label, value: e.id }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},

			async getFieldsToReturn(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entityId = this.getCurrentNodeParameter('resource') as number;
				if (!entityId) return [];

				const fields = await fetchFields.call(this, entityId);
				return fields
					.map((f) => ({ name: f.label || f.name, value: f.name }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},

			async getFilterFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entityId = this.getCurrentNodeParameter('resource') as number;
				if (!entityId) return [];

				const fields = await fetchFields.call(this, entityId);
				const options: INodePropertyOptions[] = [
					{ name: 'Record ID', value: 'id' },
					{ name: 'Record Name', value: 'recordName' },
				];
				for (const f of fields) {
					options.push({ name: f.label || f.name, value: f.name });
				}
				return options.sort((a, b) => a.name.localeCompare(b.name));
			},

			async getFileFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entityId = this.getCurrentNodeParameter('resource') as number;
				if (!entityId) return [];

				const fields = await fetchFields.call(this, entityId);
				return fields
					.filter((f) => f.type === 'File')
					.map((f) => ({ name: f.label || f.name, value: f.name }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},

		// resourceMapping: feeds the resourceMapper with fields + their types + picklist options
		// This runs once when the user opens the node — no heuristic needed, each field's
		// options are loaded directly from the brainX metadata (and reference endpoints).
		resourceMapping: {
			async getMappingColumns(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const entityId = this.getCurrentNodeParameter('resource') as number;
				if (!entityId) return { fields: [] };

				const operation = this.getCurrentNodeParameter('operation') as string;
				const isCreate = operation === 'create';

				const rawFields = await fetchFields.call(this, entityId);
				const forcedRequired = new Set(
					await getForcedRequiredFieldsForEntity.call(this, entityId),
				);
				const mapperFields: ResourceMapperField[] = [];

				for (const f of rawFields) {
					const forced = forcedRequired.has(f.name);
					if (!isEditable(f) && !(isCreate && (f.required || forced))) continue;

					const isRequired = isCreate && ((f.required ?? false) || forced);
					const mappedField: ResourceMapperField = {
						id: f.name,
						displayName: f.label || f.name,
						required: isRequired,
						defaultMatch: false,
						canBeUsedToMatch: false,
						display: true,
						removed: !isRequired, // non-required fields hidden until user adds them
						type: mapBrainXType(f.type) as ResourceMapperField['type'],
					};

					// For picklist / reference fields: load the selectable options
					if (PICKLIST_TYPES.includes(f.type)) {
						mappedField.options = await getPicklistOptionsForMapper.call(this, f);
					}

					mapperFields.push(mappedField);
				}

				// Sort fields alphabetically by label, required fields first
				mapperFields.sort((a, b) => {
					if (a.required !== b.required) return a.required ? -1 : 1;
					return a.displayName.localeCompare(b.displayName);
				});

				return { fields: mapperFields };
			},
		},
	};

	// ── Execute ────────────────────────────────────────────────────────────────

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];

		const operation = this.getNodeParameter('operation', 0) as string;
		// `resource` is hidden for customApiCall / addRelations / getRelations;
		// supply a fallback so getNodeParameter doesn't throw when absent.
		const entityId = this.getNodeParameter('resource', 0, 0) as unknown as number;

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'create') {
					const body = await buildBody(this, i, operation);
					await validateRequiredFields.call(this, entityId, body);
					const result = (await brainXApiRequest.call(
						this,
						'POST',
						`/api/entity/${entityId}/records`,
						body,
					)) as unknown as BrainXSingleRecordResponse;
					returnData.push(result.data);
				} else if (operation === 'delete') {
					const recordId = this.getNodeParameter('recordId', i) as string;
					const result = await brainXApiRequest.call(
						this,
						'DELETE',
						`/api/entity/${entityId}/records/${recordId}`,
					);
					returnData.push(result);
				} else if (operation === 'get') {
					const recordId = this.getNodeParameter('recordId', i) as string;
					const getOptions = this.getNodeParameter('getOptions', i) as IDataObject;
					const qs: IDataObject = {};
					if (getOptions.includeDeleted !== undefined)
						qs.includeDeleted = getOptions.includeDeleted;
					if (getOptions.includeFileContent !== undefined)
						qs.includeFileContent = getOptions.includeFileContent;

					if (recordId) {
						const result = (await brainXApiRequest.call(
							this,
							'GET',
							`/api/entity/${entityId}/records/${recordId}`,
							{},
							qs,
						)) as unknown as BrainXSingleRecordResponse;
						returnData.push(result.data);
					} else {
						const result = (await brainXApiRequest.call(
							this,
							'GET',
							`/api/entity/${entityId}/records`,
							{},
							qs,
						)) as {
							data?: IDataObject[];
						};
						returnData.push(...(result.data ?? []));
					}
				} else if (operation === 'search') {
					const limit = this.getNodeParameter('limit', i) as number;
					const additionalOptions = this.getNodeParameter('additionalOptions', i) as IDataObject;
					const qs: IDataObject = { limit };
					if (additionalOptions.offset) qs.offset = additionalOptions.offset;
					if (additionalOptions.fields && (additionalOptions.fields as string[]).length) {
						qs.fields = (additionalOptions.fields as string[]).join('|');
					}
					if (additionalOptions.includeDeleted !== undefined)
						qs.includeDeleted = additionalOptions.includeDeleted;
					if (additionalOptions.includeFileContent !== undefined)
						qs.includeFileContent = additionalOptions.includeFileContent;
					if (additionalOptions.filterOr) qs.filterOr = true;

					// Build filter query string with literal brackets
					const filtersData = this.getNodeParameter('filters', i) as {
						conditions?: Array<{ field: string; operator: string; value: string }>;
					};
					const sortData = this.getNodeParameter('sortOrder', i) as {
						sortFields?: Array<{ field: string; direction: string }>;
					};
					const rawQs = buildRawQs(filtersData?.conditions ?? [], sortData?.sortFields ?? []);

					const result = (await brainXApiRequest.call(
						this,
						'GET',
						`/api/entity/${entityId}/records`,
						{},
						qs,
						rawQs,
					)) as {
						data?: IDataObject[];
					};
					returnData.push(...(result.data ?? []));
				} else if (operation === 'update') {
					const recordId = this.getNodeParameter('recordId', i) as string;
					const body = await buildBody(this, i, operation);
					const result = (await brainXApiRequest.call(
						this,
						'PATCH',
						`/api/entity/${entityId}/records/${recordId}`,
						body,
					)) as unknown as BrainXSingleRecordResponse;
					returnData.push(result.data);
				} else if (operation === 'getRelations') {
					const recordId = this.getNodeParameter('recordId', i) as string;
					const result = await brainXApiRequest.call(
						this,
						'GET',
						`/api/relations/${recordId}`,
					);
					// The endpoint returns a bare JSON array; brainXApiRequest casts the
					// response to IDataObject, but at runtime it's still the array.
					const relations = (
						Array.isArray(result) ? result : ((result.data as unknown[]) ?? [])
					) as IDataObject[];
					returnData.push(...relations);
				} else if (operation === 'addRelations') {
					const recordId = this.getNodeParameter('recordId', i) as string;
					const idsRaw = this.getNodeParameter('relatedRecordIds', i) as string;
					const records = idsRaw
						.split(',')
						.map((s) => s.trim())
						.filter((s) => s.length > 0)
						.map((s) => Number.parseInt(s, 10))
						.filter((n) => Number.isFinite(n));

					if (!records.length) {
						throw new NodeOperationError(
							this.getNode(),
							'Related Record IDs must contain at least one numeric ID',
						);
					}

					const result = await brainXApiRequest.call(
						this,
						'POST',
						`/api/relations/${recordId}`,
						{ records },
					);
					returnData.push(result);
				} else if (operation === 'getCurrentUser') {
					const result = (await brainXApiRequest.call(this, 'GET', '/api/users/current')) as {
						data?: IDataObject;
					};
					returnData.push(result.data ?? result);
				} else if (operation === 'getCompanies') {
					const result = (await brainXApiRequest.call(this, 'GET', '/api/users/companies')) as {
						data?: IDataObject[];
					};
					returnData.push(...(result.data ?? []));
				} else if (operation === 'customApiCall') {
					const method = this.getNodeParameter('customMethod', i) as string;
					const rawEndpoint = (this.getNodeParameter('customEndpoint', i) as string).replace(
						/^\/+/,
						'',
					);
					const endpoint = rawEndpoint.startsWith('api/')
						? `/${rawEndpoint}`
						: `/api/${rawEndpoint}`;

					let body: IDataObject = {};
					if (method === 'POST' || method === 'PATCH') {
						const raw = this.getNodeParameter('customBody', i) as string | IDataObject;
						if (typeof raw === 'string') {
							const trimmed = raw.trim();
							if (trimmed.length) {
								try {
									body = JSON.parse(trimmed) as IDataObject;
								} catch (e) {
									throw new NodeOperationError(
										this.getNode(),
										`Custom API Call: body is not valid JSON — ${(e as Error).message}`,
									);
								}
							}
						} else if (raw && typeof raw === 'object') {
							body = raw;
						}
					}

					const result = await brainXApiRequest.call(this, method, endpoint, body);
					returnData.push(result);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ error: (error as Error).message });
					continue;
				}
				throw error;
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}

// ─── Build Filter Query String ──────────────────────────────────────────────
// Produces raw query params with literal brackets: filter[field]=value
// Duplicate fields automatically use the array syntax: filter[field][]=val

interface FilterCondition {
	field: string;
	operator: string;
	value: string;
}

function getOperatorPrefix(operator: string): string {
	switch (operator) {
		case 'exact':
			return '=';
		case 'notEquals':
			return '!';
		case 'notExact':
			return '!=';
		case 'gt':
			return '>';
		case 'lt':
			return '<';
		default:
			return ''; // 'contains' — default LIKE behaviour
	}
}

interface SortField {
	field: string;
	direction: string;
}

function buildRawQs(conditions: FilterCondition[], sortFields: SortField[]): string {
	const parts: string[] = [];

	// Filter params
	if (conditions.length) {
		const fieldCount = new Map<string, number>();
		for (const c of conditions) {
			fieldCount.set(c.field, (fieldCount.get(c.field) || 0) + 1);
		}
		for (const c of conditions) {
			const prefix = getOperatorPrefix(c.operator);
			const value = encodeURIComponent(prefix + c.value);
			const useArray = (fieldCount.get(c.field) || 1) > 1;
			const key = useArray ? `filter[${c.field}][]` : `filter[${c.field}]`;
			parts.push(`${key}=${value}`);
		}
	}

	// Order params: order[fieldName]=ASC|DESC
	for (const s of sortFields) {
		parts.push(`order[${s.field}]=${s.direction}`);
	}

	return parts.join('&');
}

// ─── Build Request Body from resourceMapper ───────────────────────────────────

// n8n's dateTime picker emits "YYYY-MM-DDTHH:mm:ss[.sss]" without a timezone
// designator, which brainX rejects as non-ISO8601. Append 'Z' (treat as UTC)
// when no TZ is present. Values that already include Z or ±HH:MM pass through.
const BARE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

function normalizeValue(value: unknown): unknown {
	if (typeof value === 'string' && BARE_DATETIME_RE.test(value)) {
		return `${value}Z`;
	}
	return value;
}

// MIME types whose subtype differs from the conventional file extension.
const MIME_EXT_OVERRIDES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/svg+xml': 'svg',
	'audio/mpeg': 'mp3',
	'application/msword': 'doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.ms-excel': 'xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.ms-powerpoint': 'ppt',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

function extensionFromMimeType(mime: string | undefined): string | undefined {
	if (!mime) return undefined;
	const cleaned = mime.toLowerCase().split(';')[0].trim();
	if (MIME_EXT_OVERRIDES[cleaned]) return MIME_EXT_OVERRIDES[cleaned];
	// Generic fallback: use the subtype (image/png → png, image/svg+xml → svg).
	const subtype = cleaned.split('/')[1]?.split('+')[0];
	return subtype || undefined;
}

function ensureExtension(name: string, mime: string | undefined): string {
	if (/\.[A-Za-z0-9]{1,5}$/.test(name)) return name;
	const ext = extensionFromMimeType(mime);
	return ext ? `${name}.${ext}` : name;
}

interface FileRow {
	field: string;
	source: 'binary' | 'base64';
	binaryProperty?: string;
	base64Content?: string;
	mimeType?: string;
	fileName?: string;
}

async function buildBody(
	ctx: IExecuteFunctions,
	i: number,
	operation: string,
): Promise<IDataObject> {
	const paramName = operation === 'create' ? 'createFields' : 'updateFields';
	const filesParamName = operation === 'create' ? 'createFiles' : 'updateFiles';

	const fieldsToSend = ctx.getNodeParameter(paramName, i) as {
		value: Record<string, string | number | boolean | null> | null;
	};

	const body: IDataObject = {};
	const values = fieldsToSend.value ?? {};

	for (const [key, value] of Object.entries(values)) {
		if (value !== null && value !== undefined) {
			body[key] = normalizeValue(value) as IDataObject[string];
		}
	}

	const filesParam = ctx.getNodeParameter(filesParamName, i, {}) as {
		file?: FileRow;
	};
	const row = filesParam.file;
	if (row?.field) {
		let content: string;
		let defaultName: string | undefined;
		let mimeType: string | undefined;

		if (row.source === 'binary') {
			const prop = row.binaryProperty || 'data';
			const binary = ctx.helpers.assertBinaryData(i, prop);
			const buffer = await ctx.helpers.getBinaryDataBuffer(i, prop);
			content = buffer.toString('base64');
			defaultName = binary.fileName;
			mimeType = binary.mimeType;
		} else {
			content = row.base64Content ?? '';
			if (!content) {
				throw new NodeOperationError(
					ctx.getNode(),
					`File field "${row.field}": Base64 Content is empty`,
				);
			}
			mimeType = row.mimeType || undefined;
		}

		const rawName = row.fileName || defaultName;
		if (!rawName) {
			throw new NodeOperationError(
				ctx.getNode(),
				`File field "${row.field}": file name is required (no binary file name and no override supplied)`,
			);
		}
		const name = ensureExtension(rawName, mimeType);

		body[row.field] = { name, content };
	}

	return body;
}
