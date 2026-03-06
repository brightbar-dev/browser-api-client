/** Export requests as cURL, fetch, or other formats. */

import type { ApiRequest, AuthConfig, KeyValuePair } from './request';
import { buildUrl, buildHeaders } from './request';

/** Generate a cURL command from a request. */
export function toCurl(req: ApiRequest): string {
  const url = buildUrl(req.url, req.params);
  const parts = [`curl -X ${req.method}`];
  parts.push(`'${url}'`);

  const headers = buildHeaders(req.headers, req.auth);
  for (const [key, value] of Object.entries(headers)) {
    parts.push(`-H '${key}: ${value}'`);
  }

  if (req.body && req.bodyType !== 'none') {
    if (req.bodyType === 'json') {
      if (!headers['Content-Type']) {
        parts.push("-H 'Content-Type: application/json'");
      }
      parts.push(`-d '${req.body}'`);
    } else if (req.bodyType === 'form') {
      parts.push(`--data-urlencode '${req.body}'`);
    } else {
      parts.push(`-d '${req.body}'`);
    }
  }

  return parts.join(' \\\n  ');
}

/** Generate a JavaScript fetch() call from a request. */
export function toFetch(req: ApiRequest): string {
  const url = buildUrl(req.url, req.params);
  const headers = buildHeaders(req.headers, req.auth);

  const options: string[] = [];
  options.push(`  method: '${req.method}'`);

  if (Object.keys(headers).length > 0) {
    const headerLines = Object.entries(headers)
      .map(([k, v]) => `    '${k}': '${v}'`)
      .join(',\n');
    options.push(`  headers: {\n${headerLines}\n  }`);
  }

  if (req.body && req.bodyType !== 'none') {
    if (req.bodyType === 'json') {
      options.push(`  body: JSON.stringify(${req.body})`);
    } else {
      options.push(`  body: '${req.body}'`);
    }
  }

  return `fetch('${url}', {\n${options.join(',\n')}\n})`;
}

/** Generate a Python requests snippet. */
export function toPython(req: ApiRequest): string {
  const url = buildUrl(req.url, req.params);
  const headers = buildHeaders(req.headers, req.auth);

  const lines = ['import requests', ''];

  if (Object.keys(headers).length > 0) {
    const headerItems = Object.entries(headers)
      .map(([k, v]) => `    '${k}': '${v}'`)
      .join(',\n');
    lines.push(`headers = {\n${headerItems}\n}`);
  }

  const method = req.method.toLowerCase();
  const args = [`'${url}'`];
  if (Object.keys(headers).length > 0) args.push('headers=headers');
  if (req.body && req.bodyType === 'json') args.push(`json=${req.body}`);
  else if (req.body && req.bodyType !== 'none') args.push(`data='${req.body}'`);

  lines.push(`response = requests.${method}(${args.join(', ')})`);
  lines.push('print(response.json())');

  return lines.join('\n');
}
