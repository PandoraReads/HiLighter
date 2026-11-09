import { describe, expect, it } from 'vitest';
import { DOMParser as LinkeDOMParser } from 'linkedom';
import {
	coverZipPath,
	dirOf,
	parseContainerXml,
	parseCoverXhtml,
	parseOpfMeta,
	rawZipPath,
	resolveZipHref,
	type XmlParser,
} from '../src/epub/epub-meta';

/** Adapter: the runtime passes 'application/xml'; linkedom wants 'text/xml'. */
const parser: XmlParser = {
	parseFromString(source: string, _mimeType: string) {
		return new LinkeDOMParser().parseFromString(source, 'text/xml') as unknown as XMLDocument;
	},
} as unknown as XmlParser;

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF_META_COVER = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>三体</dc:title>
    <dc:creator>刘慈欣</dc:creator>
  </metadata>
  <manifest>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <metadata2/>
</package>`;

const OPF_PROPERTIES_COVER = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Property Book</dc:title>
    <dc:creator>An Author</dc:creator>
    <meta property="relation">ignored</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="covers/c1.png" media-type="image/png" properties="cover-image"/>
  </manifest>
</package>`;

describe('epub container.xml parsing', () => {
	it('extracts the OPF full-path', () => {
		expect(parseContainerXml(CONTAINER, parser)).toBe('OEBPS/content.opf');
	});

	it('returns null for malformed xml', () => {
		expect(parseContainerXml('<not-a-container', parser)).toBeNull();
		expect(parseContainerXml('', parser)).toBeNull();
	});
});

describe('epub OPF parsing', () => {
	it('reads title and author through the dc namespace', () => {
		const meta = parseOpfMeta(OPF_META_COVER, parser);
		expect(meta.title).toBe('三体');
		expect(meta.author).toBe('刘慈欣');
	});

	it('resolves the cover via <meta name="cover">', () => {
		const opf = OPF_META_COVER.replace('</metadata>', '<meta name="cover" content="cover"/></metadata>');
		const meta = parseOpfMeta(opf, parser);
		expect(meta.coverHref).toBe('images/cover.jpg');
		expect(meta.coverType).toBe('image/jpeg');
	});

	it('falls back to the cover-image manifest property', () => {
		const meta = parseOpfMeta(OPF_PROPERTIES_COVER, parser);
		expect(meta.title).toBe('Property Book');
		expect(meta.coverHref).toBe('covers/c1.png');
		expect(meta.coverType).toBe('image/png');
	});

	it('resolves covers even when the package has no dc:title', () => {
		const noTitle = OPF_PROPERTIES_COVER.replace(
			'<dc:title>Property Book</dc:title>',
			'<dc:subtitle>no title here</dc:subtitle>',
		);
		const meta = parseOpfMeta(noTitle, parser);
		expect(meta.title).toBeUndefined();
		expect(meta.coverHref).toBe('covers/c1.png');
	});

	it('rejects non-image items pointed at by meta[name=cover]', () => {
		const opf = OPF_META_COVER.replace(
			'</metadata>',
			'<meta name="cover" content="ncx"/></metadata>',
		);
		// The ncx item is not an image; the cover marker is ignored and the
		// id-contains-cover fallback takes over.
		const meta = parseOpfMeta(opf, parser);
		expect(meta.coverHref).toBe('images/cover.jpg');
	});

	it('falls back to an image item whose id mentions cover', () => {
		const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Legacy Book</dc:title>
  </metadata>
  <manifest>
    <item id="text01" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="book-cover-img" href="img/c.jpg" media-type="image/jpeg"/>
  </manifest>
</package>`;
		const meta = parseOpfMeta(opf, parser);
		expect(meta.title).toBe('Legacy Book');
		expect(meta.coverHref).toBe('img/c.jpg');
	});

	it('passes xhtml wrapper pages through as cover candidates', () => {
		const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="text01" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
</package>`;
		const meta = parseOpfMeta(opf, parser);
		// The id fallback allows wrapper pages: the caller unwraps them.
		expect(meta.coverHref).toBe('cover.xhtml');
		expect(meta.coverType).toBe('application/xhtml+xml');
	});

	it('does not misread ids like discover as cover tokens', () => {
		const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <manifest>
    <item id="discover-map" href="img/map.png" media-type="image/png"/>
  </manifest>
</package>`;
		const meta = parseOpfMeta(opf, parser);
		expect(meta.coverHref).toBeUndefined();
	});

	it('keeps a partial result when the package is malformed', () => {
		const meta = parseOpfMeta('<package><metadata><dc:title', parser);
		expect(meta.title).toBeUndefined();
		expect(meta.coverHref).toBeUndefined();
	});
});

describe('epub cover.xhtml unwrapping', () => {
	it('extracts the first img src from a wrapper page', () => {
		const html = '<html><body><div class="cover"><img src="../images/c0ver.jpeg" alt="cover"/></div></body></html>';
		expect(parseCoverXhtml(html, parser)).toBe('../images/c0ver.jpeg');
	});

	it('returns null for pages without images', () => {
		expect(parseCoverXhtml('<html><body><p>text</p></body></html>', parser)).toBeNull();
		expect(parseCoverXhtml('', parser)).toBeNull();
	});
});

describe('epub zip path resolution', () => {
	it('dirOf splits the entry directory', () => {
		expect(dirOf('OEBPS/content.opf')).toBe('OEBPS');
		expect(dirOf('content.opf')).toBe('');
	});

	it('resolves hrefs relative to the OPF directory', () => {
		expect(resolveZipHref('OEBPS', 'images/cover.jpg')).toBe('OEBPS/images/cover.jpg');
	});

	it('normalizes ../ segments', () => {
		expect(resolveZipHref('OEBPS/text', '../images/cover.jpg')).toBe('OEBPS/images/cover.jpg');
		expect(resolveZipHref('OEBPS', '../../root.png')).toBe('root.png');
	});

	it('decodes percent-encoded hrefs', () => {
		expect(resolveZipHref('OEBPS', 'images/my%20cover.jpg')).toBe('OEBPS/images/my cover.jpg');
	});

	it('coverZipPath returns null without a cover href', () => {
		expect(coverZipPath('OEBPS', {})).toBeNull();
		expect(coverZipPath('OEBPS', { coverHref: 'images/c.jpg' })).toBe('OEBPS/images/c.jpg');
	});

	it('rawZipPath joins without decoding', () => {
		expect(rawZipPath('OEBPS', 'my%20cover.jpg')).toBe('OEBPS/my%20cover.jpg');
		expect(rawZipPath('', 'images/c.jpg')).toBe('images/c.jpg');
		expect(rawZipPath('OEBPS', './images/c.jpg')).toBe('OEBPS/images/c.jpg');
	});
});
