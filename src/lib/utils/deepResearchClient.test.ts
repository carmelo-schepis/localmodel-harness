import { afterEach, describe, expect, it, vi } from 'vitest';
import { researchHeaders } from './deepResearchClient';

afterEach(() => vi.unstubAllGlobals());
describe('research authentication', () => {
	it('authenticates the bundled proxy without sending credentials to external companions', () => {
		vi.stubGlobal('window', { location: { origin: 'http://nas:3000' } });
		vi.stubGlobal('localStorage', { getItem: () => 'fixture-token' });
		expect(researchHeaders('/api/v1/hugo/research')).toEqual({ Authorization: 'Bearer fixture-token' });
		expect(researchHeaders('http://nas:8787')).toEqual({});
		expect(researchHeaders('https://external.example')).toEqual({});
	});
	it('works without browser storage', () => {
		vi.stubGlobal('window', undefined);
		expect(researchHeaders('/api/v1/hugo/research')).toEqual({});
	});
});
