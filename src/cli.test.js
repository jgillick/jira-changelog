import { parseRange } from './cli'

describe('parseRange', () => {
    test('parses symmetric <sha1>...<sha2>', () => {
        const range = parseRange('e9f569df...cd1f7cd6');
        expect(range.from).toBe('e9f569df');
        expect(range.to).toBe('cd1f7cd6');
        expect(range.symmetric).toBe(true);
    });
    test('parses non-symmetric <sha1>..<sha2>', () => {
        const range = parseRange('e9f569df..cd1f7cd6');
        expect(range.from).toBe('e9f569df');
        expect(range.to).toBe('cd1f7cd6');
        expect(range.symmetric).toBe(false);
    });
    test('parses <sha1>', () => {
        const range = parseRange('e9f569df');
        expect(range.from).toBe('e9f569df');
        expect(range.to).toBe('');
        expect(range.symmetric).toBe(false);
    });
    test('invalid pattern', () => {
        expect(() => parseRange('...')).toThrow(Error);
    });
})
