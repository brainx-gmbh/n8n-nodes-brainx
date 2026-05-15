import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

export class BrainXApi implements ICredentialType {
	name = 'brainXApi';
	displayName = 'brainX API';
	icon = 'file:../nodes/BrainX/brainx.svg' as const;
	documentationUrl = 'https://brainx.app';
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://your-instance.brainx.app/',
			required: true,
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'API Password',
			name: 'apiPassword',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');
		const response = await fetch(`${baseUrl}/api/auth`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/vnd.brainformatik.crm-v2+json',
			},
			body: JSON.stringify({
				user: String(credentials.username),
				apiPassword: String(credentials.apiPassword),
			}),
		});

		if (!response.ok) {
			throw new Error(`Authentication failed: ${response.statusText}`);
		}

		const { accessToken } = (await response.json()) as { accessToken: string };

		return {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				'Content-Type': 'application/vnd.brainformatik.crm-v2+json',
				Authorization: `Bearer ${accessToken}`,
			},
		};
	}

	test: ICredentialTestRequest = {
		request: {
			method: 'POST',
			url: '={{($credentials.baseUrl.endsWith("/") ? $credentials.baseUrl.slice(0, -1) : $credentials.baseUrl) + "/api/auth"}}',
			headers: {
				'Content-Type': 'application/vnd.brainformatik.crm-v2+json',
			},
			body: '={{JSON.stringify({ user: $credentials.username, apiPassword: $credentials.apiPassword })}}',
		},
	};
}
